import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AdapterRunRequest,
  AdapterRunResult,
  HarnessManifest,
} from "@llm-bench/contracts";

import type { JsonlProcessHarnessOptions } from "./process-harness";
import type { ProcessRunner, ProcessRunResult } from "./types";
import { JsonlProcessHarnessAdapter } from "./process-harness";

const manifest: HarnessManifest = {
  id: "fixture",
  version: "1.0.0",
  capabilities: ["response_generation"],
  modelRoutes: [],
};

class FixtureHarness extends JsonlProcessHarnessAdapter<{ message: string }> {
  override command(): string[] {
    return [this.binary];
  }

  protected override parseEvent(line: string): { message: string } {
    return JSON.parse(line) as { message: string };
  }

  protected override complete(
    _request: AdapterRunRequest,
    events: { message: string }[],
    _process: ProcessRunResult,
  ): AdapterRunResult {
    return {
      status: "completed",
      output: events.at(-1)?.message ?? "",
      observations: [],
      checkpoint: null,
      events,
      metadata: {},
    };
  }

  constructor(
    readonly binary: string,
    options: JsonlProcessHarnessOptions = {},
  ) {
    super(manifest, options);
  }
}

describe("JsonlProcessHarnessAdapter", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("runs a JSONL fixture through the common harness contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "process-harness-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { prompt += chunk; });
process.stdin.on("end", () => console.log(JSON.stringify({ message: prompt.toUpperCase() })));
`,
    );
    await chmod(executable, 0o700);

    const result = await new FixtureHarness(executable).run({
      mode: "response",
      jobId: "job-1",
      caseId: "case-1",
      prompt: "hello",
      workspaceRoot: root,
      benchmark: { id: "response", version: "1.0.0" },
      modelRouteId: "fixture",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 5_000, maxToolCalls: 0, maxTokens: 100 },
      checkpoint: null,
    });

    expect(result.output).toBe("HELLO");
  });

  it("rejects malformed process events with their JSONL line number", async () => {
    const root = await mkdtemp(join(tmpdir(), "process-harness-"));
    roots.push(root);
    const executable = join(root, "fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.log(JSON.stringify({ message: "first" }));
  console.log("not-json");
});
`,
    );
    await chmod(executable, 0o700);

    await expect(
      new FixtureHarness(executable).run({
        mode: "response",
        jobId: "job-1",
        caseId: "case-1",
        prompt: "hello",
        workspaceRoot: root,
        benchmark: { id: "response", version: "1.0.0" },
        modelRouteId: "fixture",
        toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
        limits: { maxDurationMs: 5_000, maxToolCalls: 0, maxTokens: 100 },
        checkpoint: null,
      }),
    ).rejects.toMatchObject({
      name: "MalformedProcessEventError",
      lineNumber: 2,
    });
  });

  it("rejects an empty process command before execution", async () => {
    class EmptyCommandHarness extends FixtureHarness {
      override command(): string[] {
        return [];
      }
    }

    await expect(
      new EmptyCommandHarness("unused").run({
        mode: "response",
        jobId: "job-1",
        caseId: "case-1",
        prompt: "hello",
        workspaceRoot: process.cwd(),
        benchmark: { id: "response", version: "1.0.0" },
        modelRouteId: "fixture",
        toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
        limits: { maxDurationMs: 5_000, maxToolCalls: 0, maxTokens: 100 },
        checkpoint: null,
      }),
    ).rejects.toThrow("Process command is empty.");
  });

  it("passes an explicit cancellation signal and process options to the runner", async () => {
    const controller = new AbortController();
    const run = vi.fn<ProcessRunner["run"]>(() =>
      Promise.resolve<ProcessRunResult>({
        exitCode: 0,
        signal: null,
        stdoutLines: ['{"message":"fixture"}'],
        stderr: "",
        outputBytes: 21,
        cancelled: false,
      }),
    );
    const harness = new FixtureHarness("fixture", {
      runner: { run },
      env: { FIXTURE_MODE: "safe", OMITTED: undefined },
      maxOutputBytes: 123,
      redact: ["secret"],
    });

    const result = await harness.run({
      mode: "response",
      jobId: "job-1",
      caseId: "case-1",
      prompt: "hello",
      workspaceRoot: process.cwd(),
      benchmark: { id: "response", version: "1.0.0" },
      modelRouteId: "fixture",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 5_000, maxToolCalls: 0, maxTokens: 100 },
      checkpoint: null,
      signal: controller.signal,
    });

    expect(result.output).toBe("fixture");
    const request = run.mock.calls[0]?.[0];
    expect(request?.argv).toEqual(["fixture"]);
    expect(request?.env).toMatchObject({ FIXTURE_MODE: "safe" });
    expect(request?.maxOutputBytes).toBe(123);
    expect(request?.redact).toEqual(["secret"]);
  });
});
