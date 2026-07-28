import { describe, expect, it } from "vitest";

import type { HandshakeReply } from "./index";
import {
  assertCompatibleProtocolVersion,
  assertValidRunTranscript,
  decodeProtocolLine,
  encodeProtocolLine,
  MAX_PROTOCOL_LINE_BYTES,
  PluginProtocolVersionError,
  RunRequestSchema,
  RunResultSchema,
} from "./index";

describe("the executable plugin protocol", () => {
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
      assertValidRunTranscript([
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
      ]),
    ).not.toThrow();
    expect(() => assertValidRunTranscript([])).toThrow("exactly one terminal");
    expect(() =>
      assertValidRunTranscript([
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
      ]),
    ).toThrow("expected 0, received 1");
    expect(() =>
      assertValidRunTranscript([
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
      ]),
    ).toThrow("event after");
    expect(() =>
      assertValidRunTranscript([
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
      ]),
    ).toThrow("more than one");
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
