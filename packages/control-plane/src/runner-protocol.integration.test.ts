import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RunnerExecution } from "@llm-bench/contracts";

import {
  repositoryRepairLimits,
  repositoryRepairWorkload,
} from "./benchmark-registry";
import {
  createDatabase,
  createRunnerJobService,
  createRunnerProtocolService,
  migrateDatabase,
  PostgresRunnerJobStore,
  PostgresRunnerProtocolStore,
  resetTestDatabase,
} from "./index";
import {
  artifacts,
  attempts,
  credentialProfiles,
  experiments,
  jobs as jobRows,
  results,
  runnerPairings,
  runners,
  targets,
  users,
} from "./schema";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for Postgres integration tests.",
  );
}

const database = createDatabase(connectionString);

const execution: RunnerExecution = {
  workload: repositoryRepairWorkload,
  target: {
    modelRoute: { id: "fixture", provider: "codex", model: "fixture/model" },
    harness: {
      id: "codex",
      version: "1.0.0",
      capabilities: ["workspaces", "files"],
      modelRoutes: [
        { id: "fixture", provider: "codex", model: "fixture/model" },
      ],
    },
    toolset: { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
  },
  limits: repositoryRepairLimits,
  credential: null,
};

beforeAll(async () => {
  await resetTestDatabase(connectionString);
  await migrateDatabase(connectionString);
});

afterAll(async () => database.close());

describe("durable runner protocol", () => {
  it("persists pairing and atomically leases one job to one runner", async () => {
    const ownerId = randomUUID();
    await database.db.insert(users).values({
      id: ownerId,
      githubId: "runner-owner",
      githubLogin: "runner-owner",
    });
    const [experiment] = await database.db
      .insert(experiments)
      .values({ ownerId, name: "Runner tracer" })
      .returning();
    if (!experiment) throw new Error("Expected experiment.");
    const [target] = await database.db
      .insert(targets)
      .values({
        experimentId: experiment.id,
        position: 0,
        modelRoute: execution.target.modelRoute,
        harness: execution.target.harness,
        toolset: execution.target.toolset,
      })
      .returning();
    if (!target) throw new Error("Expected target.");

    const protocolStore = new PostgresRunnerProtocolStore(database.db);
    const protocol = createRunnerProtocolService({ store: protocolStore });
    const legacyTokenHash = createHash("sha256")
      .update("legacy-token")
      .digest("hex");
    await database.db.insert(runners).values({
      ownerId,
      name: "legacy-runner",
      publicKey: "legacy-der-public-key",
      protocolVersion: "1.0",
      tokenHash: legacyTokenHash,
      status: "online",
      capabilities: ["workspaces", "files"],
      environment: {},
    });
    await expect(
      protocolStore.findRunnerByTokenHash(legacyTokenHash),
    ).resolves.toBeNull();

    const pairRunner = async (name: string) => {
      const pairing = await protocol.startPairing({
        protocolVersion: "2.0",
        name,
        publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        capabilities: ["workspaces", "files"],
        environment: {
          os: "linux",
          architecture: "arm64",
          cpuClass: "fixture",
          memoryMb: 8192,
          runtimeVersions: { node: "22.21.0" },
          harnessVersions: { codex: "0.142.1" },
          sandboxMode: "process",
          contentHashes: {},
        },
      });
      const { runnerId } = await protocol.approvePairing(
        { userId: ownerId, githubLogin: "runner-owner", isAdmin: false },
        pairing.userCode,
      );
      await expect(
        protocolStore.findRunnerById(runnerId),
      ).resolves.toMatchObject({ tokenHash: "" });
      const polls = await Promise.allSettled([
        protocol.pollPairing(pairing.deviceCode),
        protocol.pollPairing(pairing.deviceCode),
      ]);
      const approvals = polls.filter(
        (
          poll,
        ): poll is PromiseFulfilledResult<
          Awaited<ReturnType<typeof protocol.pollPairing>>
        > => poll.status === "fulfilled",
      );
      expect(approvals).toHaveLength(1);
      const approval = approvals[0]?.value;
      if (approval?.status !== "approved") {
        throw new Error("Expected approval.");
      }
      return protocol.authenticate(approval.token);
    };
    const [first, second] = await Promise.all([
      pairRunner("runner-one"),
      pairRunner("runner-two"),
    ]);
    const jobStore = new PostgresRunnerJobStore(database.db);
    const jobService = createRunnerJobService({ store: jobStore });
    await expect(
      jobService.enqueue({
        ownerId,
        benchmark: { id: "repository-repair", version: "1.0.0" },
        requiredCapabilities: [],
        execution,
      }),
    ).rejects.toThrow("require an experiment and target");
    await jobService.enqueue({
      ownerId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
      execution,
    });

    const leases = await Promise.all([
      jobService.lease(first),
      jobService.lease(second),
    ]);

    expect(leases.filter(Boolean)).toHaveLength(1);
    const winningIndex = leases.findIndex(Boolean);
    const lease = leases[winningIndex];
    const winner = winningIndex === 0 ? first : second;
    const loser = winningIndex === 0 ? second : first;
    if (!lease) throw new Error("Expected winning lease.");

    await expect(jobService.lease(winner)).resolves.toBeNull();
    await expect(jobService.lease(loser)).resolves.toBeNull();
    await jobService.recordEvents(winner, {
      protocolVersion: "2.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      events: [
        {
          sequence: 0,
          event: {
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          },
        },
      ],
    });
    await jobService.recordEvents(winner, {
      protocolVersion: "2.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      events: [
        {
          sequence: 0,
          event: {
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          },
        },
      ],
    });
    await jobService.saveCheckpoint(winner, {
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      checkpoint: { sequence: 1, resumable: true, state: { cursor: 1 } },
    });
    await jobService.requestCancellation(ownerId, lease.jobId);
    await expect(jobService.cancellationStatus(winner, lease)).resolves.toEqual(
      { cancellationRequested: true },
    );
    await jobService.complete(winner, {
      protocolVersion: "2.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "completed",
      observations: [
        { metricId: "hidden_test_pass_ratio", value: 1 },
        { metricId: "custom_count", value: 2 },
      ],
      artifacts: [
        {
          kind: "log",
          blobPath: "blob://runner-one/attempt.log",
          contentHash: "attempt-log-hash",
          byteLength: 128,
        },
      ],
      error: null,
    });
    await jobService.complete(winner, {
      protocolVersion: "2.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "failed",
      observations: [],
      artifacts: [],
      error: { message: "late conflicting terminal" },
    });
    await database.db
      .update(attempts)
      .set({ status: "running" })
      .where(eq(attempts.id, lease.attemptId));
    await database.db
      .update(jobRows)
      .set({ status: "running" })
      .where(eq(jobRows.id, lease.jobId));
    await jobStore.complete(lease.attemptId, lease.jobId, "completed", {
      attemptId: lease.attemptId,
      status: "completed",
      observations: [
        { metricId: "hidden_test_pass_ratio", value: 1 },
        { metricId: "custom_count", value: 2 },
      ],
      artifacts: [
        {
          kind: "log",
          blobPath: "blob://runner-one/attempt.log",
          contentHash: "attempt-log-hash",
          byteLength: 128,
        },
      ],
      error: null,
    });
    const resultRows = await database.db
      .select()
      .from(results)
      .where(eq(results.attemptId, lease.attemptId));
    expect(resultRows).toHaveLength(1);
    const artifactRows = await database.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.resultId, resultRows[0]?.id ?? randomUUID()));
    expect(artifactRows).toHaveLength(1);

    await jobService.enqueue({
      ownerId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
      execution,
    });
    const emptyFailureLease = await jobService.lease(loser);
    if (!emptyFailureLease) throw new Error("Expected empty failure lease.");
    await jobService.complete(loser, {
      protocolVersion: "2.0",
      attemptId: emptyFailureLease.attemptId,
      leaseToken: emptyFailureLease.leaseToken,
      status: "failed",
      observations: [],
      artifacts: [],
      error: { message: "empty failure" },
    });
    await expect(
      database.db
        .select()
        .from(results)
        .where(eq(results.attemptId, emptyFailureLease.attemptId)),
    ).resolves.toHaveLength(0);

    await expect(
      jobService.saveCheckpoint(winner, {
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        checkpoint: { sequence: 2, resumable: true, state: {} },
      }),
    ).rejects.toThrow("Checkpoint sequence must advance.");
    await expect(jobStore.findAttempt(lease.attemptId)).resolves.toMatchObject({
      status: "completed",
      terminal: { status: "completed" },
    });
    const staleHeartbeat = { ...winner };
    await protocol.revokeAuthenticated(winner);
    await protocol.heartbeat(staleHeartbeat);
    const revokedRunner = await protocolStore.findRunnerById(winner.id);
    expect(revokedRunner?.revokedAt).toBeInstanceOf(Date);
    expect(revokedRunner?.status).toBe("disabled");

    await expect(jobStore.findAttempt(randomUUID())).resolves.toBeNull();
    await expect(jobStore.findJob(randomUUID())).resolves.toBeNull();
    await expect(
      protocolStore.findRunnerById(randomUUID()),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findRunnerByTokenHash("missing"),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findPairingByUserCodeHash("missing"),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findPairingByDeviceHash("missing"),
    ).resolves.toBeNull();

    const pairingForRace = await protocol.startPairing({
      protocolVersion: "2.0",
      name: "race-runner",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      capabilities: ["workspaces", "files"],
      environment: first.environment,
    });
    const consumedPairing = await protocolStore.findPairingByUserCodeHash(
      hashSecret(pairingForRace.userCode),
    );
    if (!consumedPairing) throw new Error("Expected pairing.");
    const raceRunner = { ...first, id: randomUUID(), tokenHash: "" };
    const claimedPairing = {
      ...consumedPairing,
      ownerId,
      runnerId: raceRunner.id,
    };
    const claimed = await protocolStore.approvePairing(
      claimedPairing,
      raceRunner,
    );
    expect(claimed).toBe(true);
    await expect(
      protocolStore.approvePairing(
        { ...consumedPairing, ownerId, runnerId: randomUUID() },
        { ...raceRunner, id: randomUUID() },
      ),
    ).resolves.toBe(false);
    const consumedAt = new Date();
    await expect(
      protocolStore.consumePairing(claimedPairing, raceRunner, consumedAt),
    ).resolves.toBe(true);
    await expect(
      protocolStore.consumePairing(claimedPairing, raceRunner, consumedAt),
    ).resolves.toBe(false);

    const missingMetadataJobId = randomUUID();
    await database.db.insert(jobRows).values({
      id: missingMetadataJobId,
      experimentId: experiment.id,
      targetId: target.id,
      execution,
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
    });
    await expect(jobStore.findJob(missingMetadataJobId)).rejects.toThrow(
      "missing benchmark metadata",
    );
    const incompatibleJobId = randomUUID();
    await database.db.insert(jobRows).values({
      id: incompatibleJobId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmarkId: "repository-repair",
      benchmarkVersion: "1.0.0",
      execution: {
        ...execution,
        target: {
          ...execution.target,
          harness: { ...execution.target.harness, modelRoutes: [] },
        },
      },
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
    });
    const malformedJobId = randomUUID();
    await database.db.insert(jobRows).values({
      id: malformedJobId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmarkId: "repository-repair",
      benchmarkVersion: "1.0.0",
      execution: { malformed: true } as unknown as RunnerExecution,
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
    });
    await expect(jobStore.findJob(malformedJobId)).rejects.toThrow(
      "Invalid input",
    );
    await jobService.enqueue({
      ownerId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
      execution,
    });
    const leaseAfterMalformed = await jobService.lease(loser);
    expect(leaseAfterMalformed?.execution).toEqual(execution);
    await expect(
      database.db
        .select({ status: jobRows.status })
        .from(jobRows)
        .where(
          inArray(jobRows.id, [
            missingMetadataJobId,
            incompatibleJobId,
            malformedJobId,
          ]),
        )
        .orderBy(jobRows.queuePosition),
    ).resolves.toEqual([
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
    ]);
    if (!leaseAfterMalformed) throw new Error("Expected valid job lease.");
    await jobService.complete(loser, {
      protocolVersion: "2.0",
      attemptId: leaseAfterMalformed.attemptId,
      leaseToken: leaseAfterMalformed.leaseToken,
      status: "failed",
      observations: [],
      artifacts: [],
      error: { kind: "fixture" },
    });

    const llmExecution = (runnerId: string, provider = "openrouter") => ({
      ...execution,
      target: {
        modelRoute: {
          id: "openrouter-fixture",
          provider: "openrouter",
          model: "fixture/model",
        },
        harness: {
          id: "llmbench",
          version: "1.0.0",
          capabilities: [],
          modelRoutes: [
            {
              id: "openrouter-fixture",
              provider: "openrouter",
              model: "fixture/model",
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
      credential: {
        profileId: randomUUID(),
        provider,
        sealed: {
          algorithm: "x25519-xsalsa20poly1305-seal" as const,
          runnerId,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      },
    });
    const wrongRunnerJobId = randomUUID();
    const wrongProviderJobId = randomUUID();
    for (const [id, snapshot] of [
      [wrongRunnerJobId, llmExecution(winner.id)],
      [wrongProviderJobId, llmExecution(loser.id, "other-provider")],
    ] as const) {
      await database.db.insert(jobRows).values({
        id,
        experimentId: experiment.id,
        targetId: target.id,
        benchmarkId: "repository-repair",
        benchmarkVersion: "1.0.0",
        execution: snapshot,
        workload: snapshot.workload,
        limits: snapshot.limits,
      });
    }
    await jobService.enqueue({
      ownerId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: [],
      execution,
    });
    const leaseAfterMismatches = await jobService.lease(loser);
    expect(leaseAfterMismatches?.execution).toEqual(execution);
    await expect(
      database.db
        .select({ status: jobRows.status })
        .from(jobRows)
        .where(inArray(jobRows.id, [wrongRunnerJobId, wrongProviderJobId]))
        .orderBy(jobRows.queuePosition),
    ).resolves.toEqual([{ status: "queued" }, { status: "queued" }]);
    const malformedCompletionJobId = randomUUID();
    await database.db.insert(jobRows).values({
      id: malformedCompletionJobId,
      experimentId: experiment.id,
      targetId: target.id,
      status: "leased",
      execution,
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
    });
    const malformedCompletionAttemptId = randomUUID();
    await database.db.insert(attempts).values({
      id: malformedCompletionAttemptId,
      jobId: malformedCompletionJobId,
      number: 1,
      status: "leased",
      runnerId: loser.id,
      leaseTokenHash: "lease-token-hash",
    });
    await expect(
      jobStore.complete(
        malformedCompletionAttemptId,
        malformedCompletionJobId,
        "completed",
        {
          attemptId: malformedCompletionAttemptId,
          status: "completed",
          observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
          artifacts: [],
          error: null,
        },
      ),
    ).rejects.toThrow("missing benchmark metadata");
    const malformedAttemptId = randomUUID();
    await database.db.insert(attempts).values({
      id: malformedAttemptId,
      jobId: malformedJobId,
      number: 1,
    });
    await expect(jobStore.findAttempt(malformedAttemptId)).rejects.toThrow(
      "missing lease metadata",
    );

    const malformedPairingHash = hashSecret("malformed-v1-pairing");
    await database.db.insert(runnerPairings).values({
      deviceCodeHash: malformedPairingHash,
      userCodeHash: hashSecret("MALFORMED"),
      request: {
        protocolVersion: "2.0",
        name: "legacy-key-shape",
        publicKey: "legacy-der-public-key",
        capabilities: [],
        environment: {},
      },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      protocolStore.findPairingByDeviceHash(malformedPairingHash),
    ).rejects.toThrow("Expected canonical raw 32-byte X25519 key material.");
    const legacyPairingHash = hashSecret("persisted-v1-pairing");
    await database.db.insert(runnerPairings).values({
      deviceCodeHash: legacyPairingHash,
      userCodeHash: hashSecret("LEGACY"),
      request: {
        protocolVersion: "1.0",
        name: "legacy-pairing",
        publicKey: "legacy-der-public-key",
        capabilities: [],
        environment: {},
      },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      protocolStore.findPairingByDeviceHash(legacyPairingHash),
    ).resolves.toBeNull();
  }, 120_000);

  it("does not lease credentials to a runner revoked after authentication", async () => {
    const ownerId = randomUUID();
    const runnerId = randomUUID();
    const token = "runner-token-before-revocation";
    const tokenHash = hashSecret(token);
    const sealedCredential = {
      algorithm: "x25519-xsalsa20poly1305-seal" as const,
      runnerId,
      keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
      ciphertext: "A".repeat(68),
    };
    const llmExecution: RunnerExecution = {
      workload: repositoryRepairWorkload,
      target: {
        modelRoute: {
          id: "openrouter-race",
          provider: "openrouter",
          model: "fixture/model",
        },
        harness: {
          id: "llmbench",
          version: "1.0.0",
          capabilities: ["response_generation", "workspaces", "files"],
          modelRoutes: [
            {
              id: "openrouter-race",
              provider: "openrouter",
              model: "fixture/model",
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
      limits: repositoryRepairLimits,
      credential: {
        profileId: randomUUID(),
        provider: "openrouter",
        sealed: sealedCredential,
      },
    };

    await database.db.insert(users).values({
      id: ownerId,
      githubId: `revocation-${ownerId}`,
      githubLogin: `revocation-${ownerId}`,
    });
    await database.db.insert(runners).values({
      id: runnerId,
      ownerId,
      name: "revoked-claim-runner",
      publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      protocolVersion: "2.0",
      tokenHash,
      status: "online",
      capabilities: ["response_generation", "workspaces", "files"],
      environment: {
        os: "linux",
        architecture: "x64",
        cpuClass: "fixture",
        memoryMb: 4096,
        runtimeVersions: { node: "22.21.0" },
        harnessVersions: { llmbench: "1.0.0" },
        sandboxMode: "process",
        contentHashes: {},
      },
    });
    const [experiment] = await database.db
      .insert(experiments)
      .values({ ownerId, name: "Revoked runner claim" })
      .returning();
    if (!experiment) throw new Error("Expected experiment.");
    const [target] = await database.db
      .insert(targets)
      .values({
        experimentId: experiment.id,
        position: 0,
        modelRoute: llmExecution.target.modelRoute,
        harness: llmExecution.target.harness,
        toolset: llmExecution.target.toolset,
      })
      .returning();
    if (!target) throw new Error("Expected target.");
    await database.db.insert(credentialProfiles).values({
      id: llmExecution.credential?.profileId,
      ownerId,
      runnerId,
      label: "Revocation race credential",
      provider: "openrouter",
      maskedSecret: "••••race",
      sealedCredential,
    });
    const [job] = await database.db
      .insert(jobRows)
      .values({
        experimentId: experiment.id,
        targetId: target.id,
        credentialProfileId: llmExecution.credential?.profileId,
        runnerId,
        benchmarkId: "repository-repair",
        benchmarkVersion: "1.0.0",
        execution: llmExecution,
        workload: llmExecution.workload,
        limits: llmExecution.limits,
        requiredCapabilities: ["response_generation", "workspaces", "files"],
      })
      .returning();
    if (!job) throw new Error("Expected queued job.");

    const protocolStore = new PostgresRunnerProtocolStore(database.db);
    const protocol = createRunnerProtocolService({ store: protocolStore });
    const authenticatedRunner = await protocol.authenticate(token);
    await protocol.revokeAuthenticated(authenticatedRunner);

    const jobStore = new PostgresRunnerJobStore(database.db);
    await expect(
      jobStore.claimNext({
        runner: authenticatedRunner,
        attemptId: randomUUID(),
        leaseTokenHash: hashSecret("revoked-lease-token"),
      }),
    ).resolves.toBeNull();
    await expect(
      database.db
        .select({ status: jobRows.status })
        .from(jobRows)
        .where(eq(jobRows.id, job.id)),
    ).resolves.toEqual([{ status: "queued" }]);
    await expect(
      database.db
        .select({ id: attempts.id })
        .from(attempts)
        .where(eq(attempts.jobId, job.id)),
    ).resolves.toEqual([]);
  });
});

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
