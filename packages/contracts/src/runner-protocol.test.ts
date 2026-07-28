import { describe, expect, it } from "vitest";

import {
  RUNNER_PROTOCOL_VERSION,
  RunnerEventBatchRequestSchema,
  RunnerHeartbeatRequestSchema,
  RunnerLeaseResponseSchema,
  RunnerPairingPollResponseSchema,
  RunnerPairingStartRequestSchema,
  RunnerTerminalRequestSchema,
} from "./runner-protocol";

const runnerPublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const execution = {
  workload: {
    kind: "agentic",
    task: {
      id: "clamp",
      language: "typescript",
      constraints: ["Keep the public API stable."],
      repetitions: 1,
    },
    fixtureContentHash: "a".repeat(64),
    graderHash: "b".repeat(64),
  },
  target: {
    modelRoute: {
      id: "openrouter-gpt-4o",
      provider: "openrouter",
      model: "openai/gpt-4o",
    },
    harness: {
      id: "llmbench",
      version: "1.0.0",
      capabilities: ["workspaces", "files"],
      modelRoutes: [
        {
          id: "openrouter-gpt-4o",
          provider: "openrouter",
          model: "openai/gpt-4o",
        },
      ],
    },
    toolset: {
      id: "builtin",
      version: "1.0.0",
      tools: ["read_file", "list_directory", "search_files", "apply_patch"],
      mcpProfiles: [],
    },
  },
  limits: {
    maxDurationMs: 30_000,
    maxToolCalls: 20,
    maxTokens: 10_000,
    maxTurns: 10,
  },
  credential: {
    profileId: "ee647ec6-d16d-452f-9ff4-f8f1efa4e954",
    provider: "openrouter",
    sealed: {
      algorithm: "x25519-xsalsa20poly1305-seal",
      runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
      ciphertext:
        "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQw==",
    },
  },
};

describe("runner protocol", () => {
  it("validates a leased tracer job returned to a paired runner", () => {
    expect(
      RunnerLeaseResponseSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        lease: {
          jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
          attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
          leaseToken: "lease-token",
          benchmark: { id: "repository-repair", version: "1.0.0" },
          execution,
          queuePosition: 0,
          checkpoint: null,
          cancellationRequested: false,
        },
      }),
    ).toMatchObject({ lease: { queuePosition: 0 } });
  });

  it("accepts only privacy-safe runner identity during pairing", () => {
    const input = {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      name: "workstation",
      publicKey: runnerPublicKey,
      capabilities: ["workspaces", "files"],
      environment: {
        os: "linux",
        architecture: "arm64",
        cpuClass: "Apple M4",
        memoryMb: 32768,
        runtimeVersions: { node: "22.21.0" },
        harnessVersions: {},
        sandboxMode: "process",
        contentHashes: { runner: "sha256:abc" },
      },
    };

    expect(RunnerPairingStartRequestSchema.parse(input)).toEqual(input);
    expect(() =>
      RunnerPairingStartRequestSchema.parse({
        ...input,
        environment: { ...input.environment, hostname: "private-host" },
      }),
    ).toThrow();
  });

  it("validates sequenced progress and a terminal result", () => {
    expect(
      RunnerEventBatchRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
        leaseToken: "lease-token",
        events: [
          {
            sequence: 0,
            event: {
              type: "job_started",
              at: "2026-07-01T00:00:00.000Z",
              jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
            },
          },
        ],
      }).events,
    ).toHaveLength(1);

    expect(
      RunnerTerminalRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
        leaseToken: "lease-token",
        status: "completed",
        observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
        artifacts: [
          {
            kind: "diff",
            blobPath: "attempts/d0da824f/diff.patch",
            contentHash: "sha256:abc",
            byteLength: 42,
          },
        ],
        error: null,
      }).status,
    ).toBe("completed");
  });

  it("validates pairing delivery and heartbeat without accepting another protocol major", () => {
    expect(
      RunnerPairingPollResponseSchema.parse({
        status: "approved",
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        token: "runner-token",
      }),
    ).toMatchObject({ status: "approved" });
    expect(() =>
      RunnerHeartbeatRequestSchema.parse({
        protocolVersion: "3.0",
        status: "online",
      }),
    ).toThrow();
  });
});
