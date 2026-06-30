import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ExecutionResult, FixtureHarness } from "@llm-bench/runner-engine";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

import { PARTIAL_PATCH, repairScenario } from "./fixture";
import {
  createPatchHarness,
  knownPatchHarness,
  noChangeHarness,
} from "./harness";

describe("clamp repository-repair fixture", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function run(harness: FixtureHarness): Promise<ExecutionResult> {
    const root = await mkdtemp(path.join(tmpdir(), "repair-"));
    roots.push(root);
    return executeAgenticTask({
      jobId: "job-1",
      scenario: repairScenario(),
      harness,
      limits: { maxDurationMs: 60_000, maxToolCalls: 10, maxTokens: 1_000 },
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool: new JsonlEventSpool(path.join(root, "events.jsonl")),
    });
  }

  it("fails the hidden tests while the fixture is still broken", async () => {
    const result = await run(noChangeHarness());

    expect(result.status).toBe("completed");
    expect(result.grade?.passed).toBe(1);
    expect(result.grade?.total).toBe(3);
    expect(result.grade?.passedIds).toEqual(["in-range"]);
    expect(result.grade?.failedIds).toEqual(["below-lower", "above-upper"]);
  });

  it("passes every hidden test once the known patch is applied", async () => {
    const result = await run(knownPatchHarness());

    expect(result.status).toBe("completed");
    expect(result.grade?.ratio).toBe(1);
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: 1 },
    ]);
  });

  it("detects an incomplete patch through the hidden tests", async () => {
    const result = await run(createPatchHarness(PARTIAL_PATCH));

    expect(result.status).toBe("completed");
    // The partial patch clamps the lower bound only: 2 of 3 hidden tests pass.
    expect(result.grade?.passed).toBe(2);
    expect(result.grade?.failedIds).toEqual(["above-upper"]);
  });

  it("captures the repair as a diff of the module under repair", async () => {
    const result = await run(knownPatchHarness());

    expect(result.diff.changedPaths).toEqual(["src/clamp.cjs"]);
    expect(result.diff.entries[0]?.after).toContain("if (value > upper)");
    expect(result.diffArtifact.mediaType).toBe("text/x-diff");
  });

  it("deletes the workspace after the run completes", async () => {
    const result = await run(knownPatchHarness());

    expect(result.cleanedUp).toBe(true);
  });

  it("exposes the agentic task through the benchmark", () => {
    const tasks = repairScenario().benchmark.tasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("clamp-bounds");
    expect(tasks[0]?.language).toBe("typescript");
  });
});
