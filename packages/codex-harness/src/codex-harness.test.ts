import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProcessRunner,
  ProcessRunResult,
} from "@llm-bench/process-harness";

import { CodexHarness } from "./codex-harness";

describe("CodexHarness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("completes an agentic workspace request from Codex JSONL events", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-harness-"));
    roots.push(root);
    const executable = join(root, "codex-fixture.mjs");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/clamp.cjs"), "module.exports = () => 1;\n");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", async () => {
  if (!args.includes("workspace-write") || !args.includes("--ignore-user-config") || !args.includes("--ignore-rules") || !args.includes("gpt-5.4")) process.exit(11);
  await writeFile("src/clamp.cjs", "module.exports = () => 2;\\n");
  console.log(JSON.stringify({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" }));
  console.log(JSON.stringify({ type: "turn.started" }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "Fixed the clamp boundary." } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5 } }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new CodexHarness({ binary: executable }).run({
      mode: "agentic",
      jobId: "job-1",
      caseId: "clamp-bounds",
      prompt: "Repair the clamp implementation.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: null,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "completed",
      output: "Fixed the clamp boundary.",
      checkpoint: {
        jobId: "job-1",
        sequence: 0,
        resumable: true,
        state: { threadId: "0199a213-81c0-7800-8aa1-bbab2a035a53" },
      },
      observations: [
        { metricId: "input_tokens", value: 120 },
        { metricId: "cached_input_tokens", value: 20 },
        { metricId: "output_tokens", value: 30 },
        { metricId: "reasoning_output_tokens", value: 5 },
      ],
    });
    expect(result.metadata).toMatchObject({
      harness: "codex",
      model: "gpt-5.4",
      sandbox: "workspace-write",
    });
    await expect(readFile(join(root, "src/clamp.cjs"), "utf8")).resolves.toBe(
      "module.exports = () => 2;\n",
    );
  });

  it("runs response requests read-only without retaining an ephemeral checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-harness-"));
    roots.push(root);
    const executable = join(root, "codex-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
  if (!args.includes("read-only") || !args.includes("--ephemeral")) process.exit(9);
  console.log(JSON.stringify({ type: "thread.started", thread_id: "ephemeral-thread" }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "The answer is 42." } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new CodexHarness({
      binary: executable,
      ephemeral: true,
    }).run({
      mode: "response",
      jobId: "job-2",
      caseId: "response-1",
      prompt: "What is six times seven?",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4-mini",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({
      status: "completed",
      output: "The answer is 42.",
      checkpoint: null,
      metadata: { sandbox: "read-only" },
    });
  });

  it("resumes the exact stored Codex thread and advances its checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-harness-"));
    roots.push(root);
    const executable = join(root, "codex-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
  if (args[0] !== "exec" || args[1] !== "resume" || !args.includes("thread-123")) process.exit(8);
  console.log(JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: "Resumed." } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 15, cached_input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 0 } }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new CodexHarness({ binary: executable }).run({
      mode: "agentic",
      jobId: "job-1",
      caseId: "clamp-bounds",
      prompt: "Continue the repair.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: {
        jobId: "job-1",
        sequence: 2,
        resumable: true,
        state: { threadId: "thread-123" },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      output: "Resumed.",
      checkpoint: {
        jobId: "job-1",
        sequence: 3,
        resumable: true,
        state: { threadId: "thread-123" },
      },
    });
  });

  it("resumes only a persisted checkpoint containing an opaque Codex thread id", () => {
    const persisted = new CodexHarness();
    const ephemeral = new CodexHarness({ ephemeral: true });
    const valid = {
      jobId: "job-1",
      sequence: 2,
      resumable: true,
      state: { threadId: "thread-123" },
    };

    expect(persisted.canResume(valid)).toBe(true);
    expect(persisted.canResume({ ...valid, state: { threadId: "" } })).toBe(
      false,
    );
    expect(persisted.canResume({ ...valid, state: {} })).toBe(false);
    expect(ephemeral.canResume(valid)).toBe(false);
  });

  it("reports a non-zero Codex exit without exposing configured secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-harness-"));
    roots.push(root);
    const executable = join(root, "codex-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.error("provider rejected api-secret");
  process.exit(7);
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new CodexHarness({
      binary: executable,
      redact: ["api-secret"],
    }).run({
      mode: "agentic",
      jobId: "job-3",
      caseId: "clamp-bounds",
      prompt: "Repair it.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("provider rejected [REDACTED]");
    expect(JSON.stringify(result)).not.toContain("api-secret");
  });

  it("probes Codex availability and version without reading authentication state", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-harness-"));
    roots.push(root);
    const executable = join(root, "codex-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("codex-cli 0.142.1");
  process.exit(0);
}
process.exit(10);
`,
    );
    await chmod(executable, 0o700);

    const harness = new CodexHarness({ binary: executable });

    await expect(harness.probe()).resolves.toEqual({
      available: true,
      version: "0.142.1",
    });
  });

  it("reports unavailable or unversioned Codex probes honestly", async () => {
    const results: (ProcessRunResult | Error)[] = [
      {
        exitCode: 1,
        signal: null,
        stdoutLines: [],
        stderr: "missing",
        outputBytes: 7,
        cancelled: false,
      },
      new Error("spawn failed"),
      {
        exitCode: 0,
        signal: null,
        stdoutLines: [],
        stderr: "",
        outputBytes: 25,
        cancelled: false,
      },
    ];
    const run = vi.fn(() => {
      const result = results.shift();
      if (result === undefined) throw new Error("Missing fixture result.");
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    });
    const runner: ProcessRunner = { run };
    const harness = new CodexHarness({ runner });

    await expect(harness.probe()).resolves.toEqual({
      available: false,
      version: null,
    });
    await expect(harness.probe()).resolves.toEqual({
      available: false,
      version: null,
    });
    await expect(harness.probe()).resolves.toEqual({
      available: true,
      version: null,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ argv: ["codex", "--version"] }),
    );
  });

  it("normalizes cancellation without inventing output, usage, or a checkpoint", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: null,
          signal: "SIGTERM",
          stdoutLines: [
            JSON.stringify({
              type: "item.completed",
              item: { id: "item-cancelled", type: "agent_message" },
            }),
          ],
          stderr: "",
          outputBytes: 0,
          cancelled: true,
        }),
    };

    const result = await new CodexHarness({ runner }).run({
      mode: "agentic",
      jobId: "job-cancelled",
      caseId: "clamp-bounds",
      prompt: "Repair it.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({
      status: "cancelled",
      output: "",
      observations: [],
      checkpoint: null,
    });
  });

  it.each([
    [
      { type: "error", message: "authentication expired" },
      "authentication expired",
    ],
    [{ type: "turn.failed", error: "model unavailable" }, "model unavailable"],
    [
      { type: "turn.failed", error: { code: "upstream" } },
      "Codex reported a failed turn.",
    ],
  ])("normalizes a failed Codex event %#", async (event, expected) => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: [JSON.stringify(event)],
          stderr: "",
          outputBytes: 20,
          cancelled: false,
        }),
    };

    const result = await new CodexHarness({ runner }).run({
      mode: "response",
      jobId: "job-failed",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "response", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({ status: "failed", error: expected });
  });
});
