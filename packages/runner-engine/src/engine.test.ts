import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AgenticTask, Limits } from "@llm-bench/contracts";
import { AgenticBenchmark } from "@llm-bench/contracts";

import type { HiddenTest } from "./grader";
import type { FixtureHarness, RepairScenario } from "./scenario";
import { FileArtifactStore } from "./artifact-store";
import { executeAgenticTask } from "./engine";
import { JsonlEventSpool } from "./event-spool";

const TASK: AgenticTask = {
  id: "sum-repair",
  language: "typescript",
  constraints: ["do not edit tests"],
  repetitions: 1,
};

class SumBenchmark extends AgenticBenchmark {
  tasks(): AgenticTask[] {
    return [TASK];
  }
}

function benchmark(): SumBenchmark {
  return new SumBenchmark({
    id: "repository-repair",
    version: "1.0.0",
    kind: "agentic",
    primaryMetricId: "hidden_test_pass_ratio",
    metrics: [
      {
        id: "hidden_test_pass_ratio",
        label: "Hidden test pass ratio",
        kind: "ratio",
        unit: "ratio",
        direction: "higher_is_better",
      },
    ],
    requiredCapabilities: ["workspaces", "files"],
  });
}

function hiddenTest(id: string, expectedContent?: string): HiddenTest {
  return {
    id,
    runtime: "node",
    source: `const content = require("node:fs").readFileSync(
  path.join(workspaceRoot, "src/value.txt"),
  "utf8",
);
${
  expectedContent === undefined
    ? 'assert.equal(typeof content, "string");'
    : `assert.equal(content, ${JSON.stringify(expectedContent)});`
}`,
  };
}

function scenario(hiddenTests: HiddenTest[]): RepairScenario {
  return {
    benchmark: benchmark(),
    task: TASK,
    prepare: (workspace) => workspace.writeFile("src/value.txt", "broken"),
    hiddenTests,
  };
}

const LIMITS: Limits = {
  maxDurationMs: 60_000,
  maxToolCalls: 10,
  maxTokens: 1_000,
};

describe("executeAgenticTask", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function harnessRoot(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "engine-"));
    roots.push(dir);
    return dir;
  }

  async function execute(
    over: Partial<Parameters<typeof executeAgenticTask>[0]> & {
      scenario: RepairScenario;
      harness: FixtureHarness;
    },
  ) {
    const root = await harnessRoot();
    return executeAgenticTask({
      jobId: "job-1",
      limits: LIMITS,
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool: new JsonlEventSpool(path.join(root, "events.jsonl")),
      now: counter([1_000, 1_500]),
      ...over,
    });
  }

  function counter(values: number[]): () => number {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)] ?? 0;
  }

  const writingHarness = (content: string): FixtureHarness => ({
    repair: async ({ workspace }) => {
      await workspace.writeFile("src/value.txt", content);
      return { trajectory: ["read src/value.txt", "write src/value.txt"] };
    },
  });

  it("grades a full repair through the hidden tests and reports ratio 1", async () => {
    const result = await execute({
      scenario: scenario([
        hiddenTest("is-fixed", "fixed"),
        hiddenTest("not-broken", "fixed"),
      ]),
      harness: writingHarness("fixed"),
    });

    expect(result.status).toBe("completed");
    expect(result.grade?.ratio).toBe(1);
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: 1 },
    ]);
    expect(result.trajectory).toEqual([
      "read src/value.txt",
      "write src/value.txt",
    ]);
  });

  it("detects an incomplete patch with a partial hidden-test ratio", async () => {
    const result = await execute({
      scenario: scenario([
        hiddenTest("changed", "half"),
        hiddenTest("is-fixed", "fixed"),
      ]),
      harness: writingHarness("half"),
    });

    expect(result.status).toBe("completed");
    // 1 of 2 hidden tests pass for the "half" patch.
    expect(result.grade?.ratio).toBe(0.5);
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: 0.5 },
    ]);
  });

  it("captures the final diff and stores it as an artifact", async () => {
    const result = await execute({
      scenario: scenario([hiddenTest("ok")]),
      harness: writingHarness("fixed"),
    });

    expect(result.diff.changedPaths).toEqual(["src/value.txt"]);
    expect(result.diff.entries[0]).toMatchObject({
      status: "modified",
      before: "broken",
      after: "fixed",
    });
    expect(result.diffArtifact.mediaType).toBe("text/x-diff");
    expect(result.diffArtifact.byteSize).toBeGreaterThan(0);
  });

  it("records job_started and case_completed events to the spool", async () => {
    const root = await harnessRoot();
    const eventSpool = new JsonlEventSpool(path.join(root, "events.jsonl"));

    await executeAgenticTask({
      jobId: "job-1",
      limits: LIMITS,
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool,
      now: counter([1_000, 1_500]),
      scenario: scenario([hiddenTest("ok")]),
      harness: writingHarness("fixed"),
    });

    expect(await eventSpool.events()).toEqual([
      { type: "job_started", at: "1970-01-01T00:00:01.000Z", jobId: "job-1" },
      {
        type: "case_completed",
        at: "1970-01-01T00:00:01.500Z",
        caseId: "sum-repair",
        observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      },
    ]);
  });

  it("reports a failed status and harness_error event when the harness throws", async () => {
    const root = await harnessRoot();
    const eventSpool = new JsonlEventSpool(path.join(root, "events.jsonl"));

    const result = await executeAgenticTask({
      jobId: "job-1",
      limits: LIMITS,
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool,
      now: counter([1_000, 1_500]),
      scenario: scenario([hiddenTest("ok")]),
      harness: {
        repair: () => Promise.reject(new Error("compiler crashed")),
      },
    });

    expect(result.status).toBe("failed");
    expect(result.grade).toBeNull();
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: null },
    ]);
    expect(await eventSpool.events()).toContainEqual({
      type: "job_failed",
      at: "1970-01-01T00:00:01.500Z",
      failure: { kind: "harness_error", message: "compiler crashed" },
    });
  });

  it("describes a non-Error harness rejection in the failure message", async () => {
    const result = await execute({
      scenario: scenario([hiddenTest("ok")]),
      harness: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        repair: () => Promise.reject("string failure reason"),
      },
    });

    expect(result.status).toBe("failed");
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: null },
    ]);
  });

  it("cancels work and preserves the honest partial diff", async () => {
    const cancel = new AbortController();
    cancel.abort();

    const result = await execute({
      scenario: scenario([hiddenTest("ok")]),
      harness: {
        repair: async ({ workspace, signal }) => {
          await workspace.writeFile("src/value.txt", "partial");
          await waitForAbort(signal);
          return { trajectory: [] };
        },
      },
      cancel: cancel.signal,
    });

    expect(result.status).toBe("cancelled");
    expect(result.grade).toBeNull();
    expect(result.diff.entries[0]).toMatchObject({ after: "partial" });
  });

  it("times out and emits a timeout failure with the limit", async () => {
    const deadline = new AbortController();
    deadline.abort();
    const root = await harnessRoot();
    const eventSpool = new JsonlEventSpool(path.join(root, "events.jsonl"));

    const result = await executeAgenticTask({
      jobId: "job-1",
      limits: LIMITS,
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool,
      now: counter([1_000, 1_500]),
      scenario: scenario([hiddenTest("ok")]),
      deadline: deadline.signal,
      harness: {
        repair: async ({ signal }) => {
          await waitForAbort(signal);
          return { trajectory: [] };
        },
      },
    });

    expect(result.status).toBe("timed_out");
    expect(await eventSpool.events()).toContainEqual({
      type: "job_failed",
      at: "1970-01-01T00:00:01.500Z",
      failure: { kind: "timeout", limitMs: 60_000 },
    });
  });

  it("deletes the workspace after a terminal run and reports it", async () => {
    const result = await execute({
      scenario: scenario([hiddenTest("ok")]),
      harness: writingHarness("fixed"),
    });

    expect(result.cleanedUp).toBe(true);
    expect(result.workspaceRoot).toBeDefined();
    expect(existsSync(result.workspaceRoot)).toBe(false);
  });

  it("cleans up the workspace when an error escapes the run", async () => {
    const root = await harnessRoot();

    await expect(
      executeAgenticTask({
        jobId: "job-1",
        limits: LIMITS,
        workspaceRoot: root,
        artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
        eventSpool: new JsonlEventSpool(path.join(root, "events.jsonl")),
        scenario: {
          ...scenario([hiddenTest("ok")]),
          prepare: () => Promise.reject(new Error("setup failed")),
        },
        harness: writingHarness("fixed"),
      }),
    ).rejects.toThrow("setup failed");

    const leftover = (await readdir(root)).filter((entry) =>
      entry.startsWith("llm-bench-workspace-"),
    );
    expect(leftover).toEqual([]);
  });

  it("honours cancellation that fires while hidden grading runs", async () => {
    const cancel = new AbortController();
    const startedAt = Date.now();
    const pending = execute({
      scenario: {
        benchmark: benchmark(),
        task: TASK,
        prepare: (workspace) => workspace.writeFile("src/value.txt", "fixed"),
        hiddenTests: [
          {
            id: "aborts-mid-grading",
            runtime: "node",
            source:
              "await new Promise((resolve) => setTimeout(resolve, 2_000));",
          },
        ],
      },
      harness: writingHarness("fixed"),
      cancel: cancel.signal,
    });
    setTimeout(() => cancel.abort(), 20);
    const result = await pending;

    expect(result.status).toBe("cancelled");
    expect(result.grade).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: null },
    ]);
  });

  it("uses the system clock when no clock is injected", async () => {
    const root = await harnessRoot();

    const result = await executeAgenticTask({
      jobId: "job-1",
      limits: LIMITS,
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool: new JsonlEventSpool(path.join(root, "events.jsonl")),
      scenario: scenario([hiddenTest("ok")]),
      harness: writingHarness("fixed"),
    });

    expect(result.status).toBe("completed");
    expect(typeof result.durationMs).toBe("number");
  });

  it("defaults the deadline to the configured duration limit", async () => {
    const result = await execute({
      scenario: scenario([hiddenTest("ok")]),
      harness: writingHarness("fixed"),
      deadline: undefined,
    });

    expect(result.status).toBe("completed");
    expect(result.durationMs).toBe(500);
  });
});

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
