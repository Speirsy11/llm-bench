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

import { ClaudeHarness } from "./claude-harness";

describe("ClaudeHarness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("completes an agentic workspace request from Claude stream-json events", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/clamp.cjs"), "module.exports = () => 1;\n");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", async () => {
  if (!args.includes("workspace-write") || !args.includes("--print")) process.exit(11);
  await writeFile("src/clamp.cjs", "module.exports = () => 2;\\n");
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc123" }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [] } } }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fixed the clamp boundary." } } }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }));
  console.log(JSON.stringify({ type: "assistant", message: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "Fixed the clamp boundary." }], model: "claude-sonnet-4-6", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 20, output_tokens: 30 } }, session_id: "sess-abc123" }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new ClaudeHarness({ binary: executable }).run({
      mode: "agentic",
      jobId: "job-1",
      caseId: "clamp-bounds",
      prompt: "Repair the clamp implementation.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
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
        state: { sessionId: "sess-abc123" },
      },
      observations: [
        { metricId: "input_tokens", value: 120 },
        { metricId: "cached_input_tokens", value: 20 },
        { metricId: "output_tokens", value: 30 },
      ],
    });
    expect(result.metadata).toMatchObject({
      harness: "claude",
      model: "claude-sonnet-4-6",
      sandbox: "workspace-write",
    });
    await expect(readFile(join(root, "src/clamp.cjs"), "utf8")).resolves.toBe(
      "module.exports = () => 2;\n",
    );
  });

  it("runs response requests read-only without retaining an ephemeral checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
  if (!args.includes("read-only") || !args.includes("--ephemeral")) process.exit(9);
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-ephemeral" }));
  console.log(JSON.stringify({ type: "assistant", message: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "The answer is 42." }], model: "claude-sonnet-4-6", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 } }, session_id: "sess-ephemeral" }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new ClaudeHarness({
      binary: executable,
      ephemeral: true,
    }).run({
      mode: "response",
      jobId: "job-2",
      caseId: "response-1",
      prompt: "What is six times seven?",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
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

  it("resumes the exact stored Claude session and advances its checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
  if (args[0] !== "resume" || !args.includes("--session-id") || !args.includes("thread-123")) process.exit(8);
  console.log(JSON.stringify({ type: "assistant", message: { id: "msg_2", type: "message", role: "assistant", content: [{ type: "text", text: "Resumed." }], model: "claude-sonnet-4-6", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 15, cache_creation_input_tokens: 0, cache_read_input_tokens: 10, output_tokens: 2 } }, session_id: "thread-123" }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new ClaudeHarness({ binary: executable }).run({
      mode: "agentic",
      jobId: "job-1",
      caseId: "clamp-bounds",
      prompt: "Continue the repair.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: {
        jobId: "job-1",
        sequence: 2,
        resumable: true,
        state: { sessionId: "thread-123" },
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      output: "Resumed.",
      checkpoint: {
        jobId: "job-1",
        sequence: 3,
        resumable: true,
        state: { sessionId: "thread-123" },
      },
    });
  });

  it("resumes only a persisted checkpoint containing an opaque Claude session id", () => {
    const persisted = new ClaudeHarness();
    const ephemeral = new ClaudeHarness({ ephemeral: true });
    const valid = {
      jobId: "job-1",
      sequence: 2,
      resumable: true,
      state: { sessionId: "thread-123" },
    };

    expect(persisted.canResume(valid)).toBe(true);
    expect(persisted.canResume({ ...valid, state: { sessionId: "" } })).toBe(
      false,
    );
    expect(persisted.canResume({ ...valid, state: {} })).toBe(false);
    expect(ephemeral.canResume(valid)).toBe(false);
  });

  it("reports a non-zero Claude exit without exposing configured secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => {
  console.error("anthropic rejected api-secret");
  process.exit(7);
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new ClaudeHarness({
      binary: executable,
      redact: ["api-secret"],
    }).run({
      mode: "agentic",
      jobId: "job-3",
      caseId: "clamp-bounds",
      prompt: "Repair it.",
      workspaceRoot: root,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("anthropic rejected [REDACTED]");
    expect(JSON.stringify(result)).not.toContain("api-secret");
  });

  it("probes Claude availability and version without reading authentication state", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("2.1.198 (Claude Code)");
  process.exit(0);
}
process.exit(10);
`,
    );
    await chmod(executable, 0o700);

    const harness = new ClaudeHarness({ binary: executable });

    await expect(harness.probe()).resolves.toEqual({
      available: true,
      version: "2.1.198",
    });
  });

  it("reports unavailable or unversioned Claude probes honestly", async () => {
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
    const harness = new ClaudeHarness({ runner });

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
      expect.objectContaining({ argv: ["claude", "--version"] }),
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
              type: "stream_event",
              event: { type: "message_start", message: {} },
            }),
          ],
          stderr: "",
          outputBytes: 0,
          cancelled: true,
        }),
    };

    const result = await new ClaudeHarness({ runner }).run({
      mode: "agentic",
      jobId: "job-cancelled",
      caseId: "clamp-bounds",
      prompt: "Repair it.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
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
    [
      { type: "error", message: "model unavailable" },
      "model unavailable",
    ],
  ])("normalizes a failed Claude event %#", async (event, expected) => {
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

    const result = await new ClaudeHarness({ runner }).run({
      mode: "response",
      jobId: "job-failed",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "response", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({ status: "failed", error: expected });
  });

  it("reports cache tokens when present in usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-harness-"));
    roots.push(root);
    const executable = join(root, "claude-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
process.stdin.resume();
process.stdin.on("end", () => {
  if (!args.includes("--print")) process.exit(10);
  console.log(JSON.stringify({ type: "assistant", message: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "Cached." }], model: "claude-sonnet-4-6", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, cache_creation_input_tokens: 30, cache_read_input_tokens: 50, output_tokens: 10 } }, session_id: "sess-cache" }));
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new ClaudeHarness({ binary: executable }).run({
      mode: "response",
      jobId: "job-cache",
      caseId: "response-1",
      prompt: "Test cache.",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.observations).toEqual([
      { metricId: "input_tokens", value: 100 },
      { metricId: "cached_input_tokens", value: 80 },
      { metricId: "output_tokens", value: 10 },
    ]);
  });

  it("reports zero cache tokens when absent from usage", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: [
            JSON.stringify({
              type: "assistant",
              message: {
                id: "msg_nc",
                type: "message",
                role: "assistant",
                content: [{ type: "text", text: "No cache." }],
                model: "claude-sonnet-4-6",
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: { input_tokens: 50, output_tokens: 10 },
              },
            }),
          ],
          stderr: "",
          outputBytes: 100,
          cancelled: false,
        }),
    };

    const result = await new ClaudeHarness({ runner }).run({
      mode: "response",
      jobId: "job-nocache",
      caseId: "response-1",
      prompt: "No cache test.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.observations).toEqual([
      { metricId: "input_tokens", value: 50 },
      { metricId: "cached_input_tokens", value: 0 },
      { metricId: "output_tokens", value: 10 },
    ]);
  });

  it("commands resume with session id from checkpoint", () => {
    const harness = new ClaudeHarness();
    const cmd = harness.command({
      mode: "agentic",
      jobId: "job-1",
      caseId: "case-1",
      prompt: "Continue.",
      workspaceRoot: "/tmp/ws",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 20, maxTokens: 1_000 },
      checkpoint: {
        jobId: "job-1",
        sequence: 1,
        resumable: true,
        state: { sessionId: "sess-resume" },
      },
      signal: new AbortController().signal,
    });

    expect(cmd).toEqual([
      "claude",
      "resume",
      "--print",
      "--model",
      "claude-sonnet-4-6",
      "--session-id",
      "sess-resume",
    ]);
  });
});
