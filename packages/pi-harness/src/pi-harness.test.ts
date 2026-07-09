import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProcessRunner,
  ProcessRunResult,
} from "@llm-bench/process-harness";

import { parsePiLine } from "./events";
import { PiHarness } from "./pi-harness";

describe("PiHarness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("completes a response request from Pi JSON-RPC events", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-harness-"));
    roots.push(root);
    const executable = join(root, "pi-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (!args.includes("--headless") || !args.includes("gpt-5.4")) process.exit(11);
const rl = createInterface({ input: process.stdin });
let count = 0;
rl.on("line", (line) => {
  count++;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    console.log(JSON.stringify({ jsonrpc: "2.0", result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } }, id: msg.id }));
  } else if (msg.method === "conversation/send") {
    console.log(JSON.stringify({ jsonrpc: "2.0", result: { id: "resp-1", model: "gpt-5.4", content: [{ type: "text", text: "The answer is 42." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: msg.id }));
  }
  if (count >= 2) process.exit(0);
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new PiHarness({ binary: executable }).run({
      mode: "response",
      jobId: "job-1",
      caseId: "response-1",
      prompt: "What is six times seven?",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({
      status: "completed",
      output: "The answer is 42.",
      observations: [
        { metricId: "input_tokens", value: 10 },
        { metricId: "output_tokens", value: 5 },
      ],
    });
    expect(result.metadata).toMatchObject({
      harness: "pi",
      model: "gpt-5.4",
    });
  });

  it("reports a JSON-RPC error as a failed run", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-harness-"));
    roots.push(root);
    const executable = join(root, "pi-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  console.log(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "model unavailable" }, id: msg.id }));
  process.exit(1);
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new PiHarness({ binary: executable }).run({
      mode: "response",
      jobId: "job-2",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("model unavailable");
  });

  it("reports a non-zero process exit without exposing secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-harness-"));
    roots.push(root);
    const executable = join(root, "pi-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("data", () => {
  console.error("rejected api-secret token");
  process.exit(7);
});
`,
    );
    await chmod(executable, 0o700);

    const result = await new PiHarness({
      binary: executable,
      redact: ["api-secret"],
    }).run({
      mode: "response",
      jobId: "job-3",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: root,
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("rejected [REDACTED] token");
    expect(JSON.stringify(result)).not.toContain("api-secret");
  });

  it("normalizes cancellation without inventing output", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: null,
          signal: "SIGTERM",
          stdoutLines: [],
          stderr: "",
          outputBytes: 0,
          cancelled: true,
        }),
    };

    const result = await new PiHarness({ runner }).run({
      mode: "response",
      jobId: "job-cancelled",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result).toMatchObject({
      status: "cancelled",
      output: "",
    });
  });

  it("probes Pi availability and version without reading authentication state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-harness-"));
    roots.push(root);
    const executable = join(root, "pi-fixture.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  console.log("1.5.0");
  process.exit(0);
}
process.exit(10);
`,
    );
    await chmod(executable, 0o700);

    const harness = new PiHarness({ binary: executable });

    await expect(harness.probe()).resolves.toEqual({
      available: true,
      version: "1.5.0",
    });
  });

  it("reports unavailable or unversioned Pi probes honestly", async () => {
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
    const harness = new PiHarness({ runner });

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
      expect.objectContaining({ argv: ["pi", "--version"] }),
    );
  });

  it("advertises Pi capabilities", () => {
    const harness = new PiHarness();

    expect(harness.advertises("response_generation")).toBe(true);
    expect(harness.advertises("shell")).toBe(true);
    expect(harness.advertises("streaming")).toBe(true);
    expect(harness.advertises("workspaces")).toBe(false);
    expect(harness.advertises("session_resume")).toBe(false);
  });

  it("ignores JSON-RPC notifications (id: null) in parsing", () => {
    const result = parsePiLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        id: null,
      }),
    );
    expect(result._kind).toBe("response");
  });

  it("throws on invalid JSON input", () => {
    expect(() => parsePiLine("not json")).toThrow("Invalid JSON");
  });

  it("throws on JSON that is not a valid JSON-RPC message", () => {
    expect(() => parsePiLine("{}")).toThrow("Unrecognized JSON-RPC message");
  });

  it("parses a JSON-RPC request with a non-null id", () => {
    const result = parsePiLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "read", arguments: { path: "/tmp" } },
        id: 42,
      }),
    );
    expect(result._kind).toBe("request");
    if (result._kind !== "request") throw new Error("Expected request");
    expect(result.method).toBe("tools/call");
    expect(result.id).toBe(42);
    expect(result.params).toEqual({
      name: "read",
      arguments: { path: "/tmp" },
    });
  });

  it("handles non-zero exit without a JSON-RPC error", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 1,
          signal: null,
          stdoutLines: [],
          stderr: "process crashed",
          outputBytes: 15,
          cancelled: false,
        }),
    };

    const result = await new PiHarness({ runner }).run({
      mode: "response",
      jobId: "job-crash",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("process crashed");
  });

  it("respects an external abort signal", async () => {
    const controller = new AbortController();
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: null,
          signal: "SIGTERM",
          stdoutLines: [],
          stderr: "",
          outputBytes: 0,
          cancelled: true,
        }),
    };

    const result = await new PiHarness({ runner }).run({
      mode: "response",
      jobId: "job-abort",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
      signal: controller.signal,
    });

    expect(result.status).toBe("cancelled");
  });

  it("handles invalid JSON-RPC line in process output", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: ["this is not json-rpc"],
          stderr: "",
          outputBytes: 20,
          cancelled: false,
        }),
    };

    await expect(
      new PiHarness({ runner }).run({
        mode: "response",
        jobId: "job-bad",
        caseId: "response-1",
        prompt: "Answer.",
        workspaceRoot: process.cwd(),
        benchmark: { id: "structured-output", version: "1.0.0" },
        modelRouteId: "gpt-5.4",
        toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
        limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
        checkpoint: null,
      }),
    ).rejects.toThrow("Invalid JSON-RPC message");
  });

  it("extracts output from result.text in response", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: [
            JSON.stringify({
              jsonrpc: "2.0",
              result: { text: "Direct text response." },
              id: 1,
            }),
          ],
          stderr: "",
          outputBytes: 50,
          cancelled: false,
        }),
    };

    const result = await new PiHarness({ runner }).run({
      mode: "response",
      jobId: "job-text",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.output).toBe("Direct text response.");
  });

  it("extracts output from result.content string in response", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: [
            JSON.stringify({
              jsonrpc: "2.0",
              result: { content: "String content." },
              id: 1,
            }),
          ],
          stderr: "",
          outputBytes: 50,
          cancelled: false,
        }),
    };

    const result = await new PiHarness({ runner }).run({
      mode: "response",
      jobId: "job-content",
      caseId: "response-1",
      prompt: "Answer.",
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-5.4",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
      checkpoint: null,
    });

    expect(result.output).toBe("String content.");
  });

  it("extracts cached usage when Pi reports it", async () => {
    const runner: ProcessRunner = {
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          stdoutLines: [
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                text: "Usage.",
                usage: {
                  input_tokens: 20,
                  cached_input_tokens: 7,
                  output_tokens: 3,
                },
              },
              id: 1,
            }),
          ],
          stderr: "",
          outputBytes: 50,
          cancelled: false,
        }),
    };

    const result = await new PiHarness({ runner }).run(request());

    expect(result.observations).toEqual([
      { metricId: "input_tokens", value: 20 },
      { metricId: "cached_input_tokens", value: 7 },
      { metricId: "output_tokens", value: 3 },
    ]);
  });

  it("rejects agentic mode before spawning Pi", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    await expect(
      new PiHarness({ runner: { run } }).run({
        ...request(),
        mode: "agentic",
      }),
    ).rejects.toThrow("response mode");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects checkpoints before spawning Pi", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    await expect(
      new PiHarness({ runner: { run } }).run({
        ...request(),
        checkpoint: {
          jobId: "job-1",
          sequence: 1,
          resumable: true,
          state: { sessionId: "opaque" },
        },
      }),
    ).rejects.toThrow("session resume");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects runner-managed tools before spawning Pi", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    await expect(
      new PiHarness({ runner: { run } }).run({
        ...request(),
        toolset: {
          id: "builtin",
          version: "1.0.0",
          tools: ["read-file"],
          mcpProfiles: [],
        },
      }),
    ).rejects.toThrow("runner-managed tools");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects MCP profiles before spawning Pi", async () => {
    const run = vi.fn<ProcessRunner["run"]>();
    await expect(
      new PiHarness({ runner: { run } }).run({
        ...request(),
        toolset: {
          id: "mcp",
          version: "1.0.0",
          tools: [],
          mcpProfiles: ["filesystem"],
        },
      }),
    ).rejects.toThrow("MCP profiles");
    expect(run).not.toHaveBeenCalled();
  });
});

function request(): Parameters<PiHarness["run"]>[0] {
  return {
    mode: "response",
    jobId: "job-validation",
    caseId: "response-1",
    prompt: "Answer.",
    workspaceRoot: process.cwd(),
    benchmark: { id: "structured-output", version: "1.0.0" },
    modelRouteId: "gpt-5.4",
    toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
    limits: { maxDurationMs: 10_000, maxToolCalls: 0, maxTokens: 1_000 },
    checkpoint: null,
  };
}
