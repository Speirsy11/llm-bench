import { describe, expect, it } from "vitest";

import type { RunnerExecution } from "@llm-bench/contracts";

import type { PairedRunner } from "./runner-protocol";
import { PostgresRunnerJobStore } from "./postgres-runner-store";

type RunnerStoreDatabase = ConstructorParameters<
  typeof PostgresRunnerJobStore
>[0];

const authenticatedRunner: PairedRunner = {
  id: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
  ownerId: "owner-1",
  name: "stale-authenticated-runner",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  capabilities: [],
  environment: {
    os: "linux",
    architecture: "x64",
    cpuClass: "fixture",
    memoryMb: 4096,
    runtimeVersions: { node: "22.21.0" },
    harnessVersions: {},
    sandboxMode: "process",
    contentHashes: {},
  },
  tokenHash: "authenticated-before-revocation",
  revokedAt: null,
  status: "online",
  lastSeenAt: null,
};

function storeWithLockedRunnerRows(rows: unknown[]) {
  let selectCalls = 0;
  const transaction = {
    select: () => {
      selectCalls += 1;
      if (selectCalls > 1) {
        throw new Error("Claim continued after locking an ineligible runner.");
      }
      return {
        from: () => ({
          where: () => ({
            for: () => Promise.resolve(rows),
          }),
        }),
      };
    },
  };
  const db = {
    transaction: (run: (value: typeof transaction) => Promise<unknown>) =>
      run(transaction),
  } as unknown as RunnerStoreDatabase;
  return {
    selectCalls: () => selectCalls,
    store: new PostgresRunnerJobStore(db),
  };
}

function claim(store: PostgresRunnerJobStore) {
  return store.claimNext({
    runner: authenticatedRunner,
    attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
    leaseTokenHash: "lease-token-hash",
  });
}

describe("PostgresRunnerJobStore", () => {
  it("stops a stale authenticated runner after the locked row is revoked", async () => {
    const lockedRunner = {
      id: authenticatedRunner.id,
      status: "disabled",
      revokedAt: new Date("2026-07-21T12:00:00.000Z"),
    };
    const { selectCalls, store } = storeWithLockedRunnerRows([lockedRunner]);

    await expect(claim(store)).resolves.toBeNull();
    expect(selectCalls()).toBe(1);
  });

  it.each([
    ["missing", []],
    [
      "disabled",
      [{ id: authenticatedRunner.id, status: "disabled", revokedAt: null }],
    ],
  ])("stops when the locked runner row is %s", async (_label, rows) => {
    const { selectCalls, store } = storeWithLockedRunnerRows(rows);

    await expect(claim(store)).resolves.toBeNull();
    expect(selectCalls()).toBe(1);
  });

  it("validates credential isolation before persisting an execution snapshot", async () => {
    const inserted: unknown[] = [];
    const db = {
      insert: () => ({
        values: (value: unknown) => {
          inserted.push(value);
          return Promise.resolve();
        },
      }),
    } as unknown as RunnerStoreDatabase;
    const store = new PostgresRunnerJobStore(db);
    const execution: RunnerExecution = {
      workload: {
        kind: "agentic",
        task: {
          id: "task",
          language: "typescript",
          constraints: [],
          repetitions: 1,
        },
        fixtureContentHash: "a".repeat(64),
        graderHash: "b".repeat(64),
      },
      target: {
        modelRoute: { id: "route", provider: "openrouter", model: "model" },
        harness: {
          id: "llmbench",
          version: "1.0.0",
          capabilities: [],
          modelRoutes: [],
        },
        toolset: { id: "tools", version: "1.0.0", tools: [], mcpProfiles: [] },
      },
      limits: {
        maxDurationMs: 1,
        maxToolCalls: 0,
        maxTokens: 1,
        maxTurns: 1,
      },
      credential: {
        profileId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        provider: "openrouter",
        sealed: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      },
    };
    const job = {
      id: "job-1",
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: [],
      execution,
      status: "queued" as const,
      position: 0,
      assignedRunnerId: null,
      cancellationRequested: false,
      experimentId: "experiment-1",
      targetId: "target-1",
    };

    await store.enqueue(job);
    expect(inserted).toMatchObject([
      { credentialProfileId: execution.credential?.profileId, execution },
    ]);
    await expect(
      store.enqueue({
        ...job,
        execution: { ...execution, credential: null },
      }),
    ).rejects.toThrow("LLMBench execution requires a sealed credential.");
    await expect(
      store.enqueue({
        ...job,
        execution: {
          ...execution,
          target: {
            ...execution.target,
            harness: { ...execution.target.harness, id: "codex" },
          },
        },
      }),
    ).rejects.toThrow(
      "Native harness execution must not reference a hosted credential.",
    );
  });

  it("rejects a completed job when the terminal result cannot be read back", async () => {
    const returningRows: unknown[][] = [[{ id: "attempt-1" }], []];
    const limitRows: unknown[][] = [
      [
        {
          id: "job-1",
          benchmarkId: "repository-repair",
          benchmarkVersion: "1.0.0",
        },
      ],
      [],
    ];
    const builder = (): Record<string, unknown> => ({
      set: builder,
      values: builder,
      where: builder,
      from: builder,
      onConflictDoNothing: builder,
      returning: () => Promise.resolve(returningRows.shift() ?? []),
      limit: () => Promise.resolve(limitRows.shift() ?? []),
    });
    const transaction = {
      update: builder,
      insert: builder,
      select: builder,
    };
    const db = {
      transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as RunnerStoreDatabase;
    const terminal = {
      attemptId: "attempt-1",
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [],
      error: null,
    } satisfies NonNullable<Parameters<PostgresRunnerJobStore["complete"]>[3]>;

    await expect(
      new PostgresRunnerJobStore(db).complete(
        "attempt-1",
        "job-1",
        "completed",
        terminal,
      ),
    ).rejects.toThrow("Completed job result was not persisted.");
  });
});
