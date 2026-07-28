import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import {
  decodeProtocolLine,
  encodeProtocolLine,
} from "@speirsy11/llm-bench-harness-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { runPluginSession } from "./plugin";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

describe("the example harness plugin protocol", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  it("advertises a repository-repair-compatible manifest during handshake", async () => {
    const output: string[] = [];

    await runPluginSession(
      lines([
        encodeProtocolLine({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
        }),
      ]),
      (line) => output.push(line),
    );

    expect(output.map(decodeProtocolLine)).toEqual([
      {
        kind: "handshake_reply",
        protocolVersion: "1.0.0",
        manifest: {
          id: "example-harness-plugin",
          name: "LLMBench example repair plugin",
          version: "1.0.0",
          description:
            "Deterministically repairs the TypeScript clamp tracer without credentials.",
          capabilities: ["response_generation", "workspaces", "files"],
          modelRoutes: [
            {
              id: "example-clamp-repair",
              provider: "example",
              model: "deterministic-clamp-repair",
            },
          ],
        },
      },
    ]);
  });

  it("rejects missing or out-of-order lifecycle messages", async () => {
    await expect(runPluginSession(lines([]), () => undefined)).resolves.toBe(
      undefined,
    );
    await expect(
      runPluginSession(
        lines([
          encodeProtocolLine({
            kind: "run_event",
            protocolVersion: "1.0.0",
            sequence: 0,
            event: { type: "started" },
          }),
        ]),
        () => undefined,
      ),
    ).rejects.toThrow("expected a handshake_request");

    await expect(
      runPluginSession(
        lines([
          encodeProtocolLine({
            kind: "handshake_request",
            protocolVersion: "1.0.0",
          }),
          encodeProtocolLine({
            kind: "handshake_request",
            protocolVersion: "1.0.0",
          }),
        ]),
        () => undefined,
      ),
    ).rejects.toThrow("expected a run_request after handshake");
  });

  it("repairs the clamp tracer through an explicitly selected toolset", async () => {
    const workspace = await fixtureWorkspace();
    const output: string[] = [];

    await runPluginSession(
      lines([
        encodeProtocolLine({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
        }),
        encodeProtocolLine({
          kind: "run_request",
          protocolVersion: "1.0.0",
          job: {
            id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
            attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
          },
          case: {
            id: "typescript-clamp-bounds",
            benchmarkId: "repository-repair",
            benchmarkVersion: "1.0.0",
          },
          prompt: "Repair clamp so it respects both bounds.",
          workspace: { root: workspace },
          toolset: {
            id: "builtin",
            version: "1.0.0",
            tools: [
              "read_file",
              "list_directory",
              "search_files",
              "apply_patch",
            ],
            mcpProfiles: [],
          },
          limits: {
            maxDurationMs: 30_000,
            maxToolCalls: 10,
            maxTokens: 10_000,
            maxTurns: 10,
          },
          checkpoint: null,
          credentials: {},
          runtime: { mcpConnections: [] },
        }),
      ]),
      (line) => output.push(line),
    );

    await expect(
      execFileAsync(process.execPath, [
        "-e",
        [
          `const { clamp } = require(${JSON.stringify(join(workspace, "src/clamp.cjs"))});`,
          "require('node:assert/strict').deepEqual(",
          "[clamp(5, 0, 10), clamp(-3, 0, 10), clamp(15, 0, 10)],",
          "[5, 0, 10]);",
        ].join("\n"),
      ]),
    ).resolves.toMatchObject({ stderr: "" });

    expect(output.slice(1).map(decodeProtocolLine)).toEqual([
      {
        kind: "run_event",
        protocolVersion: "1.0.0",
        sequence: 0,
        event: { type: "started" },
      },
      {
        kind: "run_event",
        protocolVersion: "1.0.0",
        sequence: 1,
        event: {
          type: "progress",
          message: "Applied the clamp repair with tool apply_patch.",
        },
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "completed",
        output: "Repaired typescript-clamp-bounds.",
        observations: [],
        checkpoint: null,
        metadata: {
          toolset: {
            id: "builtin",
            version: "1.0.0",
            tools: [
              "read_file",
              "list_directory",
              "search_files",
              "apply_patch",
            ],
            mcpProfiles: [],
          },
          credentialGrants: [],
        },
      },
    ]);
  });

  it("denies credential grants without exposing their values", async () => {
    const workspace = await fixtureWorkspace();
    const original = await readFile(join(workspace, "src/clamp.cjs"), "utf8");
    const output: string[] = [];
    const secret = "credential-canary-that-must-not-escape";

    await runPluginSession(
      lines([
        encodeProtocolLine({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
        }),
        encodeProtocolLine({
          kind: "run_request",
          protocolVersion: "1.0.0",
          job: {
            id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
            attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
          },
          case: {
            id: "typescript-clamp-bounds",
            benchmarkId: "repository-repair",
            benchmarkVersion: "1.0.0",
          },
          prompt: "Repair clamp so it respects both bounds.",
          workspace: { root: workspace },
          toolset: {
            id: "builtin",
            version: "1.0.0",
            tools: ["apply_patch"],
            mcpProfiles: [],
          },
          limits: {
            maxDurationMs: 30_000,
            maxToolCalls: 10,
            maxTokens: 10_000,
            maxTurns: 10,
          },
          checkpoint: null,
          credentials: { openrouter: secret },
          runtime: { mcpConnections: [] },
        }),
      ]),
      (line) => output.push(line),
    );

    expect(output.join("")).not.toContain(secret);
    expect(output.slice(1).map(decodeProtocolLine)).toEqual([
      {
        kind: "run_event",
        protocolVersion: "1.0.0",
        sequence: 0,
        event: { type: "started" },
      },
      {
        kind: "run_result",
        protocolVersion: "1.0.0",
        status: "failed",
        error:
          "This example plugin does not accept credential grants; remove them and retry.",
        checkpoint: null,
      },
    ]);
    await expect(
      readFile(join(workspace, "src/clamp.cjs"), "utf8"),
    ).resolves.toBe(original);
  });

  it("refuses to edit when the explicit toolset omits apply_patch", async () => {
    const workspace = await fixtureWorkspace();
    const original = await readFile(join(workspace, "src/clamp.cjs"), "utf8");
    const output: string[] = [];

    await runPluginSession(
      lines([
        encodeProtocolLine({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
        }),
        encodeProtocolLine({
          kind: "run_request",
          protocolVersion: "1.0.0",
          job: {
            id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
            attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
          },
          case: {
            id: "typescript-clamp-bounds",
            benchmarkId: "repository-repair",
            benchmarkVersion: "1.0.0",
          },
          prompt: "Repair clamp so it respects both bounds.",
          workspace: { root: workspace },
          toolset: {
            id: "read-only",
            version: "1.0.0",
            tools: ["read_file"],
            mcpProfiles: [],
          },
          limits: {
            maxDurationMs: 30_000,
            maxToolCalls: 10,
            maxTokens: 10_000,
            maxTurns: 10,
          },
          checkpoint: null,
          credentials: {},
          runtime: { mcpConnections: [] },
        }),
      ]),
      (line) => output.push(line),
    );

    expect(decodeProtocolLine(output.at(-1) ?? "")).toEqual({
      kind: "run_result",
      protocolVersion: "1.0.0",
      status: "failed",
      error: "The selected toolset must explicitly include apply_patch.",
      checkpoint: null,
    });
    await expect(
      readFile(join(workspace, "src/clamp.cjs"), "utf8"),
    ).resolves.toBe(original);
  });

  it("leaves the workspace unchanged for an unsupported tracer case", async () => {
    const workspace = await fixtureWorkspace();
    const original = await readFile(join(workspace, "src/clamp.cjs"), "utf8");
    const output: string[] = [];

    await runPluginSession(
      lines([
        encodeProtocolLine({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
        }),
        encodeProtocolLine({
          kind: "run_request",
          protocolVersion: "1.0.0",
          job: {
            id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
            attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
          },
          case: {
            id: "typescript-state-reducer",
            benchmarkId: "repository-repair",
            benchmarkVersion: "1.0.0",
          },
          prompt: "Repair the repository.",
          workspace: { root: workspace },
          toolset: {
            id: "builtin",
            version: "1.0.0",
            tools: ["apply_patch"],
            mcpProfiles: [],
          },
          limits: {
            maxDurationMs: 30_000,
            maxToolCalls: 10,
            maxTokens: 10_000,
            maxTurns: 10,
          },
          checkpoint: null,
          credentials: {},
          runtime: { mcpConnections: [] },
        }),
      ]),
      (line) => output.push(line),
    );

    expect(decodeProtocolLine(output.at(-1) ?? "")).toEqual({
      kind: "run_result",
      protocolVersion: "1.0.0",
      status: "failed",
      error:
        "Unsupported benchmark case; this example handles repository-repair 1.0.0 / typescript-clamp-bounds.",
      checkpoint: null,
    });
    await expect(
      readFile(join(workspace, "src/clamp.cjs"), "utf8"),
    ).resolves.toBe(original);
  });
});

function lines(values: readonly string[]): AsyncIterable<string> {
  return Readable.from(values);
}

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-bench-example-plugin-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/clamp.cjs"),
    `function clamp(value, lower, upper) {
  return value;
}
module.exports = { clamp };
`,
    "utf8",
  );
  expect(await readFile(join(root, "src/clamp.cjs"), "utf8")).toContain(
    "return value;",
  );
  return root;
}
