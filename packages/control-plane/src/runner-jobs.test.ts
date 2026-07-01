import { describe, expect, it } from "vitest";

import {
  createInMemoryRunnerJobStore,
  createRunnerJobService,
} from "./runner-jobs";

const runner = (id: string) => ({
  id,
  ownerId: "owner-1",
  name: id,
  publicKey: "public-key",
  capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
  environment: {
    os: "linux" as const,
    architecture: "arm64",
    cpuClass: "fixture",
    memoryMb: 8192,
    runtimeVersions: {},
    harnessVersions: {},
    sandboxMode: "process",
    contentHashes: {},
  },
  tokenHash: `${id}-hash`,
  revokedAt: null,
  status: "online" as const,
  lastSeenAt: null,
});

describe("runner job leasing", () => {
  it("allows only one runner to win a lease race", async () => {
    const service = createRunnerJobService({
      store: createInMemoryRunnerJobStore(),
      randomToken: () => "lease-token",
    });
    const job = await service.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });

    const leases = await Promise.all([
      service.lease(runner("runner-1")),
      service.lease(runner("runner-2")),
    ]);

    expect(leases.filter(Boolean)).toHaveLength(1);
    expect(leases.find(Boolean)).toMatchObject({
      jobId: job.id,
      queuePosition: 0,
      leaseToken: "lease-token",
    });
  });

  it("stores sequenced events idempotently before terminal completion", async () => {
    const store = createInMemoryRunnerJobStore();
    const service = createRunnerJobService({
      store,
      randomToken: () => "lease-token",
    });
    const job = await service.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });
    const pairedRunner = runner("runner-1");
    const lease = await service.lease(pairedRunner);
    if (!lease) throw new Error("Expected a lease.");
    const batch = {
      protocolVersion: "1.0" as const,
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      events: [
        {
          sequence: 0,
          event: {
            type: "job_started" as const,
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          },
        },
      ],
    };

    await service.recordEvents(pairedRunner, batch);
    await service.recordEvents(pairedRunner, batch);
    await service.complete(pairedRunner, {
      protocolVersion: "1.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [],
      error: null,
    });
    await service.complete(pairedRunner, {
      protocolVersion: "1.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "failed",
      observations: [],
      artifacts: [],
      error: { message: "late conflicting terminal" },
    });
    await expect(
      service.saveCheckpoint(pairedRunner, {
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        checkpoint: { sequence: 1, resumable: true, state: {} },
      }),
    ).rejects.toThrow("Checkpoint sequence must advance.");
    await service.requestCancellation("owner-1", job.id);

    expect(store.inspect()).toMatchObject({
      jobs: [{ status: "completed", cancellationRequested: false }],
      attempts: [{ status: "completed", terminal: { status: "completed" } }],
      events: [{ sequence: 0 }],
    });
  });

  it("exposes owner cancellation and the latest resumable checkpoint", async () => {
    const store = createInMemoryRunnerJobStore();
    const service = createRunnerJobService({
      store,
      randomToken: () => "lease-token",
    });
    const job = await service.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });
    const pairedRunner = runner("runner-1");
    const lease = await service.lease(pairedRunner);
    if (!lease) throw new Error("Expected a lease.");

    await expect(
      service.requestCancellation("owner-2", job.id),
    ).rejects.toThrow("Job is unavailable.");
    await service.saveCheckpoint(pairedRunner, {
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      checkpoint: { sequence: 3, resumable: true, state: { cursor: 2 } },
    });
    await service.requestCancellation("owner-1", job.id);

    await expect(
      service.cancellationStatus(pairedRunner, {
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
      }),
    ).resolves.toEqual({ cancellationRequested: true });
    expect(store.inspect().attempts[0]?.checkpoint).toEqual({
      sequence: 3,
      resumable: true,
      state: { cursor: 2 },
    });
  });

  it("enforces one-job concurrency, capabilities, lease ownership, and checkpoint order", async () => {
    const store = createInMemoryRunnerJobStore();
    const service = createRunnerJobService({
      store,
      randomToken: () => "lease-token",
    });
    await service.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });
    await service.enqueue({
      ownerId: "owner-1",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      requiredCapabilities: ["workspaces", "files"],
    });
    const pairedRunner = runner("runner-1");
    const lease = await service.lease(pairedRunner);
    if (!lease) throw new Error("Expected lease.");
    await expect(service.lease(pairedRunner)).resolves.toBeNull();
    await expect(
      service.lease({ ...runner("runner-limited"), capabilities: ["files"] }),
    ).resolves.toBeNull();
    await expect(
      service.cancellationStatus(runner("other-runner"), lease),
    ).rejects.toThrow("Attempt lease is unavailable.");
    await expect(
      service.cancellationStatus(pairedRunner, {
        ...lease,
        leaseToken: "wrong-token",
      }),
    ).rejects.toThrow("Attempt lease is unavailable.");
    await service.saveCheckpoint(pairedRunner, {
      ...lease,
      checkpoint: { sequence: 2, resumable: true, state: {} },
    });
    await expect(
      service.saveCheckpoint(pairedRunner, {
        ...lease,
        checkpoint: { sequence: 2, resumable: true, state: {} },
      }),
    ).rejects.toThrow("Checkpoint sequence must advance.");
    await expect(
      service.requestCancellation("owner-1", "missing-job"),
    ).rejects.toThrow("Job is unavailable.");
    expect(() => store.setCancellation("missing-job")).toThrow(
      "Job is unavailable.",
    );
    expect(() =>
      store.saveCheckpoint("missing-attempt", {
        sequence: 1,
        resumable: true,
        state: {},
      }),
    ).toThrow("Attempt is unavailable.");
    await expect(
      service.cancellationStatus(pairedRunner, {
        attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
        leaseToken: "lease-token",
      }),
    ).rejects.toThrow("Attempt lease is unavailable.");

    const missingJobService = createRunnerJobService({
      store: { ...store, findJob: () => Promise.resolve(null) },
    });
    await expect(
      missingJobService.cancellationStatus(pairedRunner, lease),
    ).rejects.toThrow("Job is unavailable.");
  });
});
