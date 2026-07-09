import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createControlPlane,
  createDatabase,
  createRunnerJobService,
  createRunnerProtocolService,
  migrateDatabase,
  PostgresRunnerJobStore,
  PostgresRunnerProtocolStore,
  resetTestDatabase,
} from "./index";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for Postgres integration tests.",
  );
}

const controlPlane = createControlPlane({ connectionString });
const database = createDatabase(connectionString);

beforeAll(async () => {
  await resetTestDatabase(connectionString);
  await migrateDatabase(connectionString);
});

afterAll(async () => {
  await Promise.all([controlPlane.close(), database.close()]);
});

describe("dashboard experiment orchestration", () => {
  it("launches a matrix for an online runner and renders a completed primary metric", async () => {
    const { actor, runner } = await pairedOnlineRunner("matrix-owner");
    const credential = await controlPlane.dashboard.saveCredentialProfile(
      actor,
      {
        label: "OpenRouter production",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "sk-or-v1...abcd",
        sealedCredential: {
          algorithm: "x25519-xsalsa20-poly1305-sealed-box",
          runnerId: runner.id,
          keyFingerprint: "fingerprint-a",
          ciphertext: "sealed-ciphertext-a",
        },
      },
    );

    const preview = await controlPlane.dashboard.previewExperiment(actor, {
      name: "Fixture repair comparison",
      runnerId: runner.id,
      credentialProfileId: credential.id,
      modelRoutes: [
        { id: "openrouter-gpt-4o", provider: "openrouter", model: "gpt-4o" },
        {
          id: "openrouter-llama",
          provider: "openrouter",
          model: "llama-3.1",
        },
      ],
      harnesses: [
        {
          id: "llmbench",
          version: "1.0.0",
          capabilities: ["workspaces", "files"],
          modelRoutes: [
            {
              id: "openrouter-gpt-4o",
              provider: "openrouter",
              model: "gpt-4o",
            },
            {
              id: "openrouter-llama",
              provider: "openrouter",
              model: "llama-3.1",
            },
          ],
        },
      ],
      toolsets: [
        { id: "builtin", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    });

    expect(preview).toMatchObject({
      canLaunch: true,
      projectedJobCount: 2,
      spend: { kind: "unknown" },
      order: [
        {
          position: 0,
          modelRouteId: "openrouter-gpt-4o",
          harnessId: "llmbench",
          toolsetId: "builtin",
          requiredCapabilities: ["workspaces", "files"],
        },
        {
          position: 1,
          modelRouteId: "openrouter-llama",
          harnessId: "llmbench",
          toolsetId: "builtin",
          requiredCapabilities: ["workspaces", "files"],
        },
      ],
    });

    await expect(
      controlPlane.dashboard.launchExperiment(actor, {
        ...preview.input,
        spendConfirmed: false,
      }),
    ).rejects.toThrow("Spend confirmation is required.");

    const launched = await controlPlane.dashboard.launchExperiment(actor, {
      ...preview.input,
      spendConfirmed: true,
    });
    expect(launched).toMatchObject({
      name: "Fixture repair comparison",
      projectedJobCount: 2,
    });

    const jobService = createRunnerJobService({
      store: new PostgresRunnerJobStore(database.db),
      randomToken: () => "lease-token",
    });
    const lease = await jobService.lease(runner);
    if (!lease) throw new Error("Expected a lease.");
    await jobService.complete(runner, {
      protocolVersion: "1.0",
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [],
      error: null,
    });

    const detail = await controlPlane.dashboard.getExperiment(
      actor,
      launched.id,
    );
    expect(detail).toMatchObject({
      id: launched.id,
      name: "Fixture repair comparison",
      progress: { completedJobs: 1, totalJobs: 2 },
      jobs: [
        {
          status: "completed",
          target: { modelRoute: { id: "openrouter-gpt-4o" } },
          primaryMetric: {
            id: "hidden_test_pass_ratio",
            label: "Hidden test pass ratio",
            value: 1,
            unit: "ratio",
          },
        },
        {
          status: "queued",
          target: { modelRoute: { id: "openrouter-llama" } },
          primaryMetric: null,
        },
      ],
    });
  });

  it("rejects offline and incompatible launches before enqueueing paid work", async () => {
    const { actor, runner } = await pairedOfflineRunner("incompat-owner");
    const credential = await controlPlane.dashboard.saveCredentialProfile(
      actor,
      {
        label: "OpenRouter staging",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "sk-or-v1...dcba",
        sealedCredential: {
          algorithm: "x25519-xsalsa20-poly1305-sealed-box",
          runnerId: runner.id,
          keyFingerprint: "fingerprint-b",
          ciphertext: "sealed-ciphertext-b",
        },
      },
    );
    const input: Parameters<
      typeof controlPlane.dashboard.previewExperiment
    >[1] = {
      name: "Offline fixture",
      runnerId: runner.id,
      credentialProfileId: credential.id,
      modelRoutes: [
        { id: "openrouter-gpt-4o", provider: "openrouter", model: "gpt-4o" },
      ],
      harnesses: [
        {
          id: "limited",
          version: "1.0.0",
          capabilities: ["workspaces"],
          modelRoutes: [
            {
              id: "openrouter-gpt-4o",
              provider: "openrouter",
              model: "gpt-4o",
            },
          ],
        },
      ],
      toolsets: [
        { id: "builtin", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    };

    const offlinePreview = await controlPlane.dashboard.previewExperiment(
      actor,
      input,
    );
    expect(offlinePreview).toMatchObject({
      canLaunch: false,
    });
    expect(offlinePreview.blockers).toEqual([
      "Runner is offline.",
      "limited is missing files.",
    ]);
    await expect(
      controlPlane.dashboard.launchExperiment(actor, {
        ...input,
        spendConfirmed: true,
      }),
    ).rejects.toThrow("Runner is offline.");

    await heartbeatRunner(runner);
    const incompatiblePreview = await controlPlane.dashboard.previewExperiment(
      actor,
      input,
    );
    expect(incompatiblePreview).toMatchObject({
      canLaunch: false,
      blockers: ["limited is missing files."],
    });
    await expect(
      controlPlane.dashboard.launchExperiment(actor, {
        ...input,
        spendConfirmed: true,
      }),
    ).rejects.toThrow("limited is missing files.");
  });

  it("keeps cancellation, retry, and private ownership auditable", async () => {
    const { actor, runner } = await pairedOnlineRunner("cancel-owner");
    const other = await controlPlane.users.upsertGitHubIdentity({
      githubId: randomUUID(),
      githubLogin: "cancel-other",
      name: "Cancel Other",
    });
    const otherActor = {
      userId: other.id,
      githubLogin: other.githubLogin,
      isAdmin: false,
    };
    const credential = await controlPlane.dashboard.saveCredentialProfile(
      actor,
      {
        label: "OpenRouter retry",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "sk-or-v1...retry",
        sealedCredential: {
          algorithm: "x25519-xsalsa20-poly1305-sealed-box",
          runnerId: runner.id,
          keyFingerprint: "fingerprint-c",
          ciphertext: "sealed-ciphertext-c",
        },
      },
    );
    const launched = await controlPlane.dashboard.launchExperiment(actor, {
      name: "Cancel and retry",
      runnerId: runner.id,
      credentialProfileId: credential.id,
      spendConfirmed: true,
      modelRoutes: [
        { id: "openrouter-gpt-4o", provider: "openrouter", model: "gpt-4o" },
      ],
      harnesses: [
        {
          id: "llmbench",
          version: "1.0.0",
          capabilities: ["workspaces", "files"],
          modelRoutes: [
            {
              id: "openrouter-gpt-4o",
              provider: "openrouter",
              model: "gpt-4o",
            },
          ],
        },
      ],
      toolsets: [
        { id: "builtin", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    });
    const detail = await controlPlane.dashboard.getExperiment(
      actor,
      launched.id,
    );
    const jobId = detail?.jobs[0]?.id;
    if (!jobId) throw new Error("Expected queued job.");

    await expect(
      controlPlane.dashboard.getExperiment(otherActor, launched.id),
    ).resolves.toBeNull();
    await expect(
      controlPlane.dashboard.cancelJob(otherActor, jobId),
    ).rejects.toThrow("Job is unavailable.");

    await controlPlane.dashboard.cancelJob(actor, jobId);
    const jobService = createRunnerJobService({
      store: new PostgresRunnerJobStore(database.db),
      randomToken: () => "retry-lease-token",
    });
    await expect(jobService.lease(runner)).resolves.toBeNull();

    const retry = await controlPlane.dashboard.retryJob(actor, jobId);
    expect(retry).toMatchObject({ retryOfJobId: jobId, status: "queued" });
    const duplicateRetry = await controlPlane.dashboard.retryJob(actor, jobId);
    expect(duplicateRetry.id).toBe(retry.id);
    const retriedDetail = await controlPlane.dashboard.getExperiment(
      actor,
      launched.id,
    );
    expect(retriedDetail).toMatchObject({
      progress: { totalJobs: 2, cancelledJobs: 1, queuedJobs: 1 },
      jobs: [
        { id: jobId, status: "cancelled", cancellationRequested: true },
        { id: retry.id, status: "queued", retryOfJobId: jobId },
      ],
    });
  });
});

async function pairedOnlineRunner(login: string) {
  const pair = await pairedOfflineRunner(login);
  await heartbeatRunner(pair.runner);
  return pair;
}

async function pairedOfflineRunner(login: string) {
  const user = await controlPlane.users.upsertGitHubIdentity({
    githubId: randomUUID(),
    githubLogin: login,
    name: login,
  });
  const actor = { userId: user.id, githubLogin: login, isAdmin: false };
  const protocol = createRunnerProtocolService({
    store: new PostgresRunnerProtocolStore(database.db),
    randomToken: () => randomUUID(),
  });
  const pairing = await protocol.startPairing({
    protocolVersion: "1.0",
    name: `${login} runner`,
    publicKey: `${login}-public-key`,
    capabilities: ["workspaces", "files"],
    environment: {
      os: "linux",
      architecture: "arm64",
      cpuClass: "fixture",
      memoryMb: 8192,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions: { fixture: "1.0.0" },
      sandboxMode: "process",
      contentHashes: {},
    },
  });
  await protocol.approvePairing(actor, pairing.userCode);
  const approved = await protocol.pollPairing(pairing.deviceCode);
  if (approved.status !== "approved") throw new Error("Expected approval.");
  const runner = await protocol.authenticate(approved.token);
  return { actor, runner };
}

async function heartbeatRunner(
  runner: Awaited<ReturnType<typeof pairedOfflineRunner>>["runner"],
) {
  const protocol = createRunnerProtocolService({
    store: new PostgresRunnerProtocolStore(database.db),
  });
  await protocol.heartbeat(runner);
}
