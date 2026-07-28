import { describe, expect, it } from "vitest";

import type { HandshakeReply } from "./index";
import {
  ArtifactVersionSchema,
  assertCompatibleProtocolVersion,
  assertValidRunTranscript,
  decodeProtocolLine,
  encodeProtocolLine,
  HandshakeRequestSchema,
  MAX_PROTOCOL_LINE_BYTES,
  PluginCaseSchema,
  PluginManifestSchema,
  PluginMcpConnectionSchema,
  PluginProtocolVersionError,
  PluginToolsetSchema,
  RunRequestSchema,
  RunResultSchema,
} from "./index";

describe("the executable plugin protocol", () => {
  it("uses full SemVer for descriptors but strict numeric wire versions", () => {
    const artifactVersion = "2.0.0-rc.1+build.7";
    expect(ArtifactVersionSchema.safeParse(artifactVersion).success).toBe(true);
    expect(ArtifactVersionSchema.safeParse("02.0.0").success).toBe(false);

    expect(
      PluginManifestSchema.safeParse({
        id: "example-plugin",
        name: "Example plugin",
        version: artifactVersion,
        capabilities: [],
        modelRoutes: [],
      }).success,
    ).toBe(true);
    expect(
      PluginCaseSchema.safeParse({
        id: "case-one",
        benchmarkId: "repair",
        benchmarkVersion: artifactVersion,
      }).success,
    ).toBe(true);
    expect(
      PluginToolsetSchema.safeParse({
        id: "repo-tools",
        version: artifactVersion,
        tools: [],
        mcpProfiles: [
          {
            id: "filesystem",
            version: artifactVersion,
            contentHash: "a".repeat(64),
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      PluginMcpConnectionSchema.safeParse({
        profile: {
          id: "filesystem",
          version: artifactVersion,
          contentHash: "a".repeat(64),
        },
        transport: "unix",
        socketPath: "/tmp/filesystem.sock",
      }).success,
    ).toBe(true);

    expect(
      HandshakeRequestSchema.safeParse({
        kind: "handshake_request",
        protocolVersion: artifactVersion,
      }).success,
    ).toBe(false);
  });

  it("round-trips a strict handshake reply", () => {
    const reply: HandshakeReply = {
      kind: "handshake_reply",
      protocolVersion: "1.0.0",
      manifest: {
        id: "example-plugin",
        name: "Example plugin",
        version: "1.2.3",
        capabilities: ["workspaces", "shell"],
        modelRoutes: [
          { id: "openai-gpt", provider: "openai", model: "gpt-4.1" },
        ],
      },
    };

    expect(decodeProtocolLine(encodeProtocolLine(reply))).toEqual(reply);
  });

  it("rejects malformed messages and unknown fields", () => {
    expect(() =>
      decodeProtocolLine(
        JSON.stringify({
          kind: "handshake_request",
          protocolVersion: "1.0.0",
          extra: true,
        }),
      ),
    ).toThrow();
    expect(() => decodeProtocolLine("not JSON")).toThrow(
      "Plugin protocol input is not valid JSON.",
    );
  });

  it("defaults a run request's credential grants to an empty record", () => {
    const result = RunRequestSchema.parse({
      kind: "run_request",
      protocolVersion: "1.0.0",
      job: {
        id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
        attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
      },
      case: {
        id: "fix-one",
        benchmarkId: "repair",
        benchmarkVersion: "1.0.0",
      },
      prompt: "Fix the test.",
      workspace: { root: "/work" },
      toolset: {
        id: "repository",
        version: "1.0.0",
        tools: ["read_file", "write_file"],
        mcpProfiles: [
          {
            id: "github",
            version: "1.0.0",
            contentHash: "a".repeat(64),
          },
        ],
      },
      limits: {
        maxDurationMs: 60_000,
        maxToolCalls: 100,
        maxTokens: 10_000,
        maxTurns: 10,
      },
      checkpoint: { sequence: 3, resumable: true, state: { session: "abc" } },
    });

    expect(result.credentials).toEqual({});
    expect(result.runtime).toEqual({ mcpConnections: [] });
  });

  it("validates strict runner-provided MCP runtime connections", () => {
    const request = RunRequestSchema.parse({
      kind: "run_request",
      protocolVersion: "1.0.0",
      job: {
        id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
        attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
      },
      case: {
        id: "fix-one",
        benchmarkId: "repair",
        benchmarkVersion: "1.0.0",
      },
      prompt: "Fix the test.",
      workspace: { root: "/work" },
      toolset: {
        id: "repository",
        version: "1.0.0",
        tools: ["read_file"],
        mcpProfiles: [
          {
            id: "filesystem",
            version: "1.0.0",
            contentHash: "a".repeat(64),
          },
        ],
      },
      limits: {
        maxDurationMs: 60_000,
        maxToolCalls: 100,
        maxTokens: 10_000,
        maxTurns: 10,
      },
      checkpoint: null,
      runtime: {
        mcpConnections: [
          {
            profile: {
              id: "filesystem",
              version: "1.0.0",
              contentHash: "a".repeat(64),
            },
            transport: "unix",
            socketPath: "/private/runner/jobs/attempt/mcp-filesystem.sock",
          },
        ],
      },
    });

    expect(request.runtime.mcpConnections).toEqual([
      {
        profile: {
          id: "filesystem",
          version: "1.0.0",
          contentHash: "a".repeat(64),
        },
        transport: "unix",
        socketPath: "/private/runner/jobs/attempt/mcp-filesystem.sock",
      },
    ]);
    expect(
      RunRequestSchema.safeParse({
        ...request,
        runtime: {
          mcpConnections: [
            { ...request.runtime.mcpConnections[0], secret: "forbidden" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("uses durable toolset, limit, checkpoint, and completed-result vocabulary", () => {
    const completed = RunResultSchema.parse({
      kind: "run_result",
      protocolVersion: "1.0.0",
      status: "completed",
      output: "Fixed the test.",
      observations: [
        { metricId: "hidden_pass_ratio", value: 1 },
        { metricId: "cost_usd", value: null },
      ],
      checkpoint: { sequence: 4, resumable: false, state: {} },
      metadata: { harnessSession: "session-1" },
    });

    expect(completed).toMatchObject({
      status: "completed",
      output: "Fixed the test.",
      observations: [
        { metricId: "hidden_pass_ratio", value: 1 },
        { metricId: "cost_usd", value: null },
      ],
    });
  });

  it("accepts all same-major versions and makes unknown majors actionable", () => {
    expect(() => assertCompatibleProtocolVersion("1.99.42")).not.toThrow();
    expect(() => assertCompatibleProtocolVersion("2.0.0")).toThrow(
      PluginProtocolVersionError,
    );
    expect(() => assertCompatibleProtocolVersion("2.0.0")).toThrow(
      "received major 2; supported major 1",
    );
    expect(() => assertCompatibleProtocolVersion("2.0.0")).toThrow(
      "Update or reinstall the plugin",
    );
    expect(() => assertCompatibleProtocolVersion("not-a-version")).toThrow(
      'Unsupported plugin protocol version "not-a-version"',
    );
  });

  it("accepts only contiguous events followed by exactly one terminal result", () => {
    expect(() =>
      assertValidRunTranscript(
        [
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
            event: { type: "progress", message: "working" },
          },
          {
            kind: "run_result",
            protocolVersion: "1.0.0",
            status: "completed",
            output: "done",
            observations: [],
            checkpoint: null,
            metadata: {},
          },
        ],
        "1.0.0",
      ),
    ).not.toThrow();
    expect(() => assertValidRunTranscript([], "1.0.0")).toThrow(
      "exactly one terminal",
    );
    expect(() =>
      assertValidRunTranscript(
        [
          {
            kind: "run_event",
            protocolVersion: "1.0.0",
            sequence: 1,
            event: { type: "started" },
          },
          {
            kind: "run_result",
            protocolVersion: "1.0.0",
            status: "cancelled",
            checkpoint: null,
          },
        ],
        "1.0.0",
      ),
    ).toThrow("expected 0, received 1");
    expect(() =>
      assertValidRunTranscript(
        [
          {
            kind: "run_result",
            protocolVersion: "1.0.0",
            status: "cancelled",
            checkpoint: null,
          },
          {
            kind: "run_event",
            protocolVersion: "1.0.0",
            sequence: 0,
            event: { type: "started" },
          },
        ],
        "1.0.0",
      ),
    ).toThrow("event after");
    expect(() =>
      assertValidRunTranscript(
        [
          {
            kind: "run_result",
            protocolVersion: "1.0.0",
            status: "cancelled",
            checkpoint: null,
          },
          {
            kind: "run_result",
            protocolVersion: "1.0.0",
            status: "cancelled",
            checkpoint: null,
          },
        ],
        "1.0.0",
      ),
    ).toThrow("more than one");
  });

  it("requires every run message to retain the negotiated protocol version", () => {
    expect(() =>
      assertValidRunTranscript(
        [
          {
            kind: "run_result",
            protocolVersion: "1.1.0",
            status: "cancelled",
            checkpoint: null,
          },
        ],
        "1.0.0",
      ),
    ).toThrow(
      "protocol changed during execution: expected 1.0.0, received 1.1.0",
    );
  });

  it("enforces a single bounded JSONL line", () => {
    const line = JSON.stringify({
      kind: "handshake_request",
      protocolVersion: "1.0.0",
    });
    expect(decodeProtocolLine(`${line}\r\n`)).toEqual({
      kind: "handshake_request",
      protocolVersion: "1.0.0",
    });
    expect(() => decodeProtocolLine("\n")).toThrow("exactly one non-empty");
    expect(() => decodeProtocolLine(`${line}\n${line}`)).toThrow(
      "exactly one non-empty",
    );
    expect(() =>
      decodeProtocolLine("x".repeat(MAX_PROTOCOL_LINE_BYTES + 1)),
    ).toThrow("byte limit");
  });
});
