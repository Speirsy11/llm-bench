import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  attempts,
  experiments,
  jobs as jobRows,
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
        modelRoute: {},
        harness: {},
        toolset: {},
      })
      .returning();
    if (!target) throw new Error("Expected target.");

    const protocolStore = new PostgresRunnerProtocolStore(database.db);
    const protocol = createRunnerProtocolService({ store: protocolStore });
    const pairRunner = async (name: string) => {
      const pairing = await protocol.startPairing({
        protocolVersion: "1.0",
        name,
        publicKey: `${name}-key`,
        capabilities: ["workspaces", "files"],
        environment: {
          os: "linux",
          architecture: "arm64",
          cpuClass: "fixture",
          memoryMb: 8192,
          runtimeVersions: { node: "22.21.0" },
          harnessVersions: {},
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
      }),
    ).rejects.toThrow("require an experiment and target");
    await jobService.enqueue({
      ownerId,
      experimentId: experiment.id,
      targetId: target.id,
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
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
      protocolVersion: "1.0",
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
      protocolVersion: "1.0",
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
      protocolVersion: "1.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [],
      error: null,
    });
    await jobService.complete(winner, {
      protocolVersion: "1.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "failed",
      observations: [],
      artifacts: [],
      error: { message: "late conflicting terminal" },
    });
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
    expect(revokedRunner?.status).toBe("offline");

    await expect(jobStore.findAttempt(randomUUID())).resolves.toBeNull();
    await expect(jobStore.findJob(randomUUID())).resolves.toBeNull();
    await expect(
      protocolStore.findRunnerById(randomUUID()),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findRunnerByTokenHash("missing"),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findPairingByUserCode("missing"),
    ).resolves.toBeNull();
    await expect(
      protocolStore.findPairingByDeviceHash("missing"),
    ).resolves.toBeNull();

    const consumedPairing = await protocolStore.findPairingByUserCode(
      (
        await protocol.startPairing({
          protocolVersion: "1.0",
          name: "race-runner",
          publicKey: "race-key",
          capabilities: ["workspaces", "files"],
          environment: first.environment,
        })
      ).userCode,
    );
    if (!consumedPairing) throw new Error("Expected pairing.");
    const raceRunner = { ...first, id: randomUUID(), tokenHash: "" };
    const claimed = await protocolStore.approvePairing(
      { ...consumedPairing, ownerId, runnerId: raceRunner.id },
      raceRunner,
    );
    expect(claimed).toBe(true);
    await expect(
      protocolStore.approvePairing(
        { ...consumedPairing, ownerId, runnerId: randomUUID() },
        { ...raceRunner, id: randomUUID() },
      ),
    ).resolves.toBe(false);

    const malformedJobId = randomUUID();
    await database.db.insert(jobRows).values({
      id: malformedJobId,
      experimentId: experiment.id,
      targetId: target.id,
    });
    await expect(jobStore.findJob(malformedJobId)).rejects.toThrow(
      "missing benchmark metadata",
    );
    const malformedAttemptId = randomUUID();
    await database.db.insert(attempts).values({
      id: malformedAttemptId,
      jobId: malformedJobId,
      number: 1,
    });
    await expect(jobStore.findAttempt(malformedAttemptId)).rejects.toThrow(
      "missing lease metadata",
    );
  });
});
