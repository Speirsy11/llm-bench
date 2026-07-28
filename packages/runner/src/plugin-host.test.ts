import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginManifest,
  PluginMessage,
} from "@speirsy11/llm-bench-harness-sdk";
import { encodeProtocolLine } from "@speirsy11/llm-bench-harness-sdk";
import { afterEach, describe, expect, it } from "vitest";

import type { AdapterRunRequest, HarnessManifest } from "@llm-bench/contracts";
import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "@llm-bench/process-harness";

import { ExecutablePluginHarness } from "./plugin-host";

const JOB_ID = "9b559298-5bf5-4642-a83d-0769ea69b4ba";
const ATTEMPT_ID = "6cb95db6-d9e3-463a-87e5-910ed42d5b18";
const manifest: HarnessManifest = {
  id: "example-plugin",
  version: "1.0.0",
  capabilities: ["response_generation", "workspaces", "files", "shell"],
  modelRoutes: [
    { id: "example-local", provider: "example", model: "deterministic" },
  ],
};
const pluginManifest: PluginManifest = {
  ...manifest,
  name: "Example plugin",
};

describe("ExecutablePluginHarness", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("handshakes and executes one isolated, explicit run transcript", async () => {
    const runner = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: pluginManifest,
      },
      {
        kind: "run_event",
        protocolVersion: "1.0.0",
        sequence: 0,
        event: { type: "started" },
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "completed",
        output: "repaired",
        observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
        checkpoint: {
          sequence: 2,
          resumable: true,
          state: { session: "safe" },
        },
        metadata: { implementation: "example" },
      },
    ]);
    const harness = new ExecutablePluginHarness(
      {
        argv: ["/opt/llm-bench/example-plugin", "--jsonl"],
        protocolVersion: "1.0.0",
        manifest,
      },
      { runner },
    );

    const result = await harness.run(request(), {
      attemptId: ATTEMPT_ID,
      credentials: { EXAMPLE_TOKEN: "explicit-secret" },
    });

    expect(result).toEqual({
      status: "completed",
      output: "repaired",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      checkpoint: {
        jobId: JOB_ID,
        sequence: 2,
        resumable: true,
        state: { session: "safe" },
      },
      events: [{ type: "started" }],
      metadata: { implementation: "example" },
    });
    expect(runner.request).toMatchObject({
      argv: ["/opt/llm-bench/example-plugin", "--jsonl"],
      cwd: "/private/workspace",
      redact: ["explicit-secret"],
    });
    expect(runner.request?.env).not.toHaveProperty("HOME");
    expect(runner.request?.env).not.toHaveProperty("EXAMPLE_TOKEN");
    const [handshake, run] = runner.inputMessages();
    expect(handshake).toEqual({
      kind: "handshake_request",
      protocolVersion: "1.0.0",
    });
    expect(run).toMatchObject({
      kind: "run_request",
      protocolVersion: "1.0.0",
      job: { id: JOB_ID, attemptId: ATTEMPT_ID },
      credentials: { EXAMPLE_TOKEN: "explicit-secret" },
      toolset: request().toolset,
    });
  });

  it("provides no ambient or implicit credential grants", async () => {
    const runner = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: pluginManifest,
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "failed",
        error: "credential denied",
        checkpoint: null,
      },
    ]);

    const result = await new ExecutablePluginHarness(
      {
        argv: ["/opt/llm-bench/example-plugin"],
        protocolVersion: "1.0.0",
        manifest,
      },
      { runner, environment: { HOME: "/secret", API_KEY: "ambient" } },
    ).run(request(), { attemptId: ATTEMPT_ID });

    expect(runner.request?.env).toEqual({});
    expect(runner.inputMessages()[1]).toMatchObject({ credentials: {} });
    expect(result).toMatchObject({
      status: "failed",
      error: "credential denied",
    });
  });

  it("rejects incompatible protocols and a manifest that changed after installation", async () => {
    const incompatible = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "2.0.0",
        manifest: pluginManifest,
      },
      {
        kind: "run_result",
        protocolVersion: "2.0.0",
        status: "cancelled",
        checkpoint: null,
      },
    ]);
    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner: incompatible },
      ).run(request(), { attemptId: ATTEMPT_ID }),
    ).rejects.toThrow("supported major 1");

    const changed = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: { ...pluginManifest, version: "1.0.1" },
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "cancelled",
        checkpoint: null,
      },
    ]);
    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner: changed },
      ).run(request(), { attemptId: ATTEMPT_ID }),
    ).rejects.toThrow("manifest changed");
  });

  it("rejects malformed lifecycle output and failed process execution", async () => {
    const missingResult = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: pluginManifest,
      },
    ]);
    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner: missingResult },
      ).run(request(), { attemptId: ATTEMPT_ID }),
    ).rejects.toThrow("exactly one terminal");

    const failed = new RecordingRunner([], {
      exitCode: 7,
      stderr: "plugin exploded",
    });
    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner: failed },
      ).run(request(), { attemptId: ATTEMPT_ID }),
    ).rejects.toThrow("exited with code 7");
    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner: new RecordingRunner([], { exitCode: null }) },
      ).run(request(), { attemptId: ATTEMPT_ID }),
    ).rejects.toThrow("exited with code null");
  });

  it("rejects missing, changed, and out-of-order lifecycle messages", async () => {
    const cases = [
      {
        messages: [
          {
            kind: "run_result" as const,
            protocolVersion: "1.0.0",
            status: "cancelled" as const,
            checkpoint: null,
          },
        ],
        error: "did not begin with a handshake reply",
      },
      {
        messages: [
          {
            kind: "handshake_reply" as const,
            protocolVersion: "1.1.0",
            manifest: pluginManifest,
          },
        ],
        error: "protocol changed after installation",
      },
      {
        messages: [
          {
            kind: "handshake_reply" as const,
            protocolVersion: "1.0.0",
            manifest: pluginManifest,
          },
          { kind: "handshake_request" as const, protocolVersion: "1.0.0" },
        ],
        error: "unexpected handshake_request",
      },
    ];
    for (const fixture of cases) {
      await expect(
        new ExecutablePluginHarness(
          {
            argv: ["/plugin"],
            protocolVersion: "1.0.0",
            manifest,
          },
          { runner: new RecordingRunner(fixture.messages) },
        ).run(request(), { attemptId: ATTEMPT_ID }),
      ).rejects.toThrow(fixture.error);
    }
  });

  it("maps cancellation and sends resumable checkpoints with default turns", async () => {
    const runner = new RecordingRunner([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: pluginManifest,
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "cancelled",
        checkpoint: null,
      },
    ]);
    const input = request();
    delete input.limits.maxTurns;
    input.checkpoint = {
      jobId: JOB_ID,
      sequence: 4,
      resumable: true,
      state: { cursor: "four" },
    };

    await expect(
      new ExecutablePluginHarness(
        {
          argv: ["/plugin"],
          protocolVersion: "1.0.0",
          manifest,
        },
        { runner },
      ).run(input, { attemptId: ATTEMPT_ID }),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(runner.inputMessages()[1]).toMatchObject({
      limits: { maxTurns: 1 },
      checkpoint: {
        sequence: 4,
        resumable: true,
        state: { cursor: "four" },
      },
    });
  });

  it("uses the real process boundary when no test runner is injected", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-host-"));
    roots.push(root);
    const executable = join(root, "plugin.mjs");
    await writeFile(
      executable,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
let line = 0;
createInterface({ input: process.stdin }).on("line", () => {
  line += 1;
  if (line === 1) process.stdout.write(JSON.stringify({ kind: "handshake_reply", protocolVersion: "1.0.0", manifest: ${JSON.stringify(pluginManifest)} }) + "\\n");
  if (line === 2) process.stdout.write(JSON.stringify({ kind: "run_result", protocolVersion: "1.0.0", status: "completed", output: "real", observations: [], checkpoint: null, metadata: {} }) + "\\n");
});`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
    const input = request();
    input.workspaceRoot = root;

    await expect(
      new ExecutablePluginHarness({
        argv: [executable],
        protocolVersion: "1.0.0",
        manifest,
      }).run(input, { attemptId: ATTEMPT_ID }),
    ).resolves.toMatchObject({ status: "completed", output: "real" });
  });
});

function request(): AdapterRunRequest {
  return {
    mode: "agentic",
    jobId: JOB_ID,
    caseId: "typescript-add",
    prompt: "Repair the repository.",
    workspaceRoot: "/private/workspace",
    benchmark: { id: "repository-repair", version: "1.0.0" },
    modelRouteId: "example-local",
    toolset: {
      id: "repository",
      version: "1.0.0",
      tools: ["read_file", "apply_patch"],
      mcpProfiles: [],
    },
    limits: {
      maxDurationMs: 10_000,
      maxToolCalls: 10,
      maxTokens: 1_000,
      maxTurns: 2,
    },
    checkpoint: null,
  };
}

class RecordingRunner implements ProcessRunner {
  request: ProcessRunRequest | undefined;

  constructor(
    private readonly messages: PluginMessage[],
    private readonly result: Partial<ProcessRunResult> = {},
  ) {}

  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.request = request;
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdoutLines: this.messages.map((message) =>
        encodeProtocolLine(message).trimEnd(),
      ),
      stderr: "",
      outputBytes: 0,
      cancelled: false,
      ...this.result,
    });
  }

  inputMessages(): PluginMessage[] {
    return (this.request?.stdin ?? "")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PluginMessage);
  }
}
