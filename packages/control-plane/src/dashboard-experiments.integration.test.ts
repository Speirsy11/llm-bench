import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Capability } from "@llm-bench/contracts";
import { LLMBENCH_REPOSITORY_TOOLS } from "@llm-bench/contracts";

import {
  repositoryRepairLimits,
  repositoryRepairWorkload,
} from "./benchmark-registry";
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
import {
  attempts as attemptRows,
  credentialProfiles as credentialProfileRows,
  experiments as experimentRows,
  jobs as jobRows,
  metrics as metricRows,
  results as resultRows,
  runners as runnerRows,
  targets as targetRows,
} from "./schema";

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
        maskedSecret: "••••abcd",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      },
    );
    await expect(
      controlPlane.dashboard.saveCredentialProfile(actor, {
        label: "Plaintext metadata",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "plain-secret",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      }),
    ).rejects.toThrow("Credential mask is invalid.");
    await expect(
      controlPlane.dashboard.saveCredentialProfile(actor, {
        label: "Wrong runner",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "••••wron",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: randomUUID(),
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      }),
    ).rejects.toThrow("Credential is not sealed for this runner.");
    await expect(
      controlPlane.dashboard.saveCredentialProfile(actor, {
        label: "Malformed envelope",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "••••badd",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "not base64!",
          ciphertext: "A".repeat(68),
        },
      }),
    ).rejects.toThrow();
    await expect(
      controlPlane.dashboard.saveCredentialProfile(actor, {
        label: "Unsupported provider",
        provider: "other-provider",
        runnerId: runner.id,
        maskedSecret: "••••badd",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      }),
    ).rejects.toThrow("Credential provider is unsupported.");
    await expect(
      controlPlane.dashboard.listCredentialProfiles(actor),
    ).resolves.toHaveLength(1);
    const listedRunners = await controlPlane.dashboard.listRunners(actor);
    expect(listedRunners).toMatchObject([
      { id: runner.id, ownerId: actor.userId, status: "online" },
    ]);
    expect(listedRunners[0]).not.toHaveProperty("tokenHash");
    await database.db
      .update(runnerRows)
      .set({ protocolVersion: "1.0" })
      .where(eq(runnerRows.id, runner.id));
    await expect(
      controlPlane.dashboard.listRunners(actor),
    ).resolves.toMatchObject([{ id: runner.id, status: "disabled" }]);
    await expect(
      controlPlane.dashboard.saveCredentialProfile(actor, {
        label: "Legacy protocol",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "••••acy0",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      }),
    ).rejects.toThrow("Runner must be re-paired before saving credentials.");
    const legacyPreview = await controlPlane.dashboard.previewExperiment(
      actor,
      {
        name: "Legacy protocol",
        runnerId: runner.id,
        modelRoutes: [],
        harnesses: [],
        toolsets: [],
      },
    );
    expect(legacyPreview.canLaunch).toBe(false);
    expect(legacyPreview.blockers).toContain(
      "Runner must be re-paired for the current protocol.",
    );
    await database.db
      .update(runnerRows)
      .set({ protocolVersion: "2.0" })
      .where(eq(runnerRows.id, runner.id));
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        name: "Missing runner",
        runnerId: randomUUID(),
        credentialProfileId: credential.id,
        modelRoutes: [],
        harnesses: [],
        toolsets: [],
      }),
    ).rejects.toThrow("Runner is unavailable.");
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        name: "Missing credential",
        runnerId: runner.id,
        credentialProfileId: randomUUID(),
        modelRoutes: [],
        harnesses: [
          {
            id: "llmbench",
            version: "1.0.0",
            capabilities: [],
            modelRoutes: [],
          },
        ],
        toolsets: [],
      }),
    ).rejects.toThrow("Credential profile is unavailable.");

    const secondRunner = await pairRunnerForActor(actor, "matrix-owner-second");
    await heartbeatRunner(secondRunner);
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        name: "Credential mismatch",
        runnerId: secondRunner.id,
        credentialProfileId: credential.id,
        modelRoutes: [],
        harnesses: [
          {
            id: "llmbench",
            version: "1.0.0",
            capabilities: [],
            modelRoutes: [],
          },
        ],
        toolsets: [],
      }),
    ).rejects.toThrow("Credential profile is not sealed for this runner.");

    await database.db
      .update(runnerRows)
      .set({ status: "disabled" })
      .where(eq(runnerRows.id, runner.id));
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        name: " ",
        runnerId: runner.id,
        credentialProfileId: credential.id,
        modelRoutes: [],
        harnesses: [],
        toolsets: [],
      }),
    ).resolves.toMatchObject({
      canLaunch: false,
      blockers: [
        "Experiment name is required.",
        "At least one model route is required.",
        "At least one harness is required.",
        "At least one toolset is required.",
        "Runner is disabled.",
      ],
    });
    await heartbeatRunner(runner);

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
          capabilities: ["response_generation", "workspaces", "files"],
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
        {
          id: "builtin",
          version: "1.0.0",
          tools: [...LLMBENCH_REPOSITORY_TOOLS],
          mcpProfiles: [],
        },
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
          requiredCapabilities: ["response_generation", "workspaces", "files"],
        },
        {
          position: 1,
          modelRouteId: "openrouter-llama",
          harnessId: "llmbench",
          toolsetId: "builtin",
          requiredCapabilities: ["response_generation", "workspaces", "files"],
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
    expect(lease.execution).toEqual({
      workload: repositoryRepairWorkload,
      target: {
        modelRoute: preview.input.modelRoutes[0],
        harness: preview.input.harnesses[0],
        toolset: preview.input.toolsets[0],
      },
      limits: repositoryRepairLimits,
      credential: {
        profileId: credential.id,
        provider: "openrouter",
        sealed: credential.sealedCredential,
      },
    });
    await jobService.complete(runner, {
      protocolVersion: "2.0",
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

    if (!detail) throw new Error("Expected experiment detail.");
    const completedJobId = detail.jobs[0]?.id;
    if (!completedJobId) throw new Error("Expected completed job.");
    const [attempt] = await database.db
      .select()
      .from(attemptRows)
      .where(eq(attemptRows.jobId, completedJobId))
      .limit(1);
    if (!attempt) throw new Error("Expected completed attempt.");
    const [result] = await database.db
      .select()
      .from(resultRows)
      .where(eq(resultRows.attemptId, attempt.id))
      .limit(1);
    if (!result) throw new Error("Expected completed result.");
    await database.db
      .delete(metricRows)
      .where(eq(metricRows.resultId, result.id));
    await database.db
      .update(attemptRows)
      .set({
        terminal: {
          attemptId: attempt.id,
          status: "completed",
          observations: [{ metricId: "hidden_test_pass_ratio", value: 0.75 }],
          artifacts: [],
          error: null,
        },
      })
      .where(eq(attemptRows.id, attempt.id));

    await expect(
      controlPlane.dashboard.getExperiment(actor, launched.id),
    ).resolves.toMatchObject({
      jobs: [
        {
          id: completedJobId,
          primaryMetric: { id: "hidden_test_pass_ratio", value: 0.75 },
        },
        { primaryMetric: null },
      ],
    });

    await database.db
      .update(attemptRows)
      .set({
        terminal: {
          attemptId: attempt.id,
          status: "completed",
          observations: "malformed",
          artifacts: [],
          error: null,
        },
      })
      .where(eq(attemptRows.id, attempt.id));

    await expect(
      controlPlane.dashboard.getExperiment(actor, launched.id),
    ).resolves.toMatchObject({
      jobs: [
        {
          id: completedJobId,
          primaryMetric: { id: "hidden_test_pass_ratio", value: null },
        },
        { primaryMetric: null },
      ],
    });

    await database.db
      .insert(experimentRows)
      .values({ ownerId: actor.userId, name: "Empty matrix shell" });
    await expect(
      controlPlane.dashboard.listExperiments(actor),
    ).resolves.toHaveLength(2);
  });

  it("rejects offline and incompatible launches before enqueueing paid work", async () => {
    const { actor, runner } = await pairedOfflineRunner("incompat-owner");
    const credential = await controlPlane.dashboard.saveCredentialProfile(
      actor,
      {
        label: "OpenRouter staging",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "••••dcba",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
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
      "Harness limited is unsupported.",
      "Harness limited lacks required capability response_generation.",
      "Harness limited lacks required capability files.",
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
      blockers: [
        "Harness limited is unsupported.",
        "Harness limited lacks required capability response_generation.",
        "Harness limited lacks required capability files.",
      ],
    });
    await expect(
      controlPlane.dashboard.launchExperiment(actor, {
        ...input,
        spendConfirmed: true,
      }),
    ).rejects.toThrow("Harness limited is unsupported.");

    const compatibleHarness = {
      id: "codex",
      version: "1.0.0",
      capabilities: [
        "response_generation",
        "workspaces",
        "files",
      ] as Capability[],
      modelRoutes: [...input.modelRoutes],
    };
    const selectedRoute = input.modelRoutes[0];
    if (!selectedRoute) throw new Error("Expected selected model route.");
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        ...input,
        harnesses: [
          {
            ...compatibleHarness,
            modelRoutes: [{ ...selectedRoute, model: "different-model" }],
          },
        ],
        toolsets: [
          {
            id: "native",
            version: "1.0.0",
            tools: [],
            mcpProfiles: [],
          },
        ],
      }),
    ).resolves.toMatchObject({
      canLaunch: false,
      blockers: [
        "Selected model route openrouter-gpt-4o is not declared by harness codex.",
      ],
    });
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        ...input,
        harnesses: [compatibleHarness],
        toolsets: [
          {
            id: "native",
            version: "1.0.0",
            tools: ["read_file"],
            mcpProfiles: [],
          },
        ],
      }),
    ).resolves.toMatchObject({
      canLaunch: false,
      blockers: [
        "Harness codex uses native tools and cannot receive runner-managed tools.",
      ],
    });
    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        ...input,
        harnesses: [{ ...compatibleHarness, id: "llmbench" }],
        toolsets: [
          {
            id: "builtin",
            version: "1.0.0",
            tools: [...LLMBENCH_REPOSITORY_TOOLS],
            mcpProfiles: ["filesystem"],
          },
        ],
      }),
    ).resolves.toMatchObject({
      canLaunch: false,
      blockers: [
        "Harness llmbench does not support runner-managed MCP profiles.",
      ],
    });

    await database.db
      .update(runnerRows)
      .set({ capabilities: ["workspaces"] })
      .where(eq(runnerRows.id, runner.id));
    const runnerAndRouteBlockers =
      await controlPlane.dashboard.previewExperiment(actor, {
        ...input,
        harnesses: [
          {
            id: "mismatched",
            version: "1.0.0",
            capabilities: ["workspaces", "files"],
            modelRoutes: [],
          },
        ],
      });
    expect(runnerAndRouteBlockers).toMatchObject({
      canLaunch: false,
      blockers: [
        "Runner is missing response_generation, files.",
        "Harness mismatched is unsupported.",
        "Selected model route openrouter-gpt-4o is not declared by harness mismatched.",
        "Harness mismatched lacks required capability response_generation.",
      ],
    });
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
        maskedSecret: "••••etry",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
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
          capabilities: ["response_generation", "workspaces", "files"],
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
        {
          id: "builtin",
          version: "1.0.0",
          tools: [...LLMBENCH_REPOSITORY_TOOLS],
          mcpProfiles: [],
        },
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
    await expect(controlPlane.dashboard.retryJob(actor, jobId)).rejects.toThrow(
      "Only terminal unsuccessful jobs can be retried.",
    );

    await controlPlane.dashboard.cancelJob(actor, jobId);
    const jobService = createRunnerJobService({
      store: new PostgresRunnerJobStore(database.db),
      randomToken: () => "retry-lease-token",
    });
    await expect(jobService.lease(runner)).resolves.toBeNull();

    const retry = await controlPlane.dashboard.retryJob(actor, jobId);
    const [originalJob] = await database.db
      .select()
      .from(jobRows)
      .where(eq(jobRows.id, jobId))
      .limit(1);
    if (!originalJob) throw new Error("Expected original job snapshot.");
    await database.db
      .update(targetRows)
      .set({
        modelRoute: {
          id: "openrouter-gpt-4o",
          provider: "openrouter",
          model: "mutated-after-launch",
        },
      })
      .where(eq(targetRows.id, originalJob.targetId));
    await database.db
      .update(credentialProfileRows)
      .set({
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "B".repeat(68),
        },
      })
      .where(eq(credentialProfileRows.id, credential.id));
    expect(retry).toMatchObject({
      retryOfJobId: jobId,
      status: "queued",
      targetId: originalJob.targetId,
      credentialProfileId: credential.id,
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
    });
    expect(retry.execution).toEqual(originalJob.execution);
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
    const retryLease = await jobService.lease(runner);
    expect(retryLease?.execution).toMatchObject({
      workload: repositoryRepairWorkload,
      limits: repositoryRepairLimits,
      target: {
        modelRoute: { id: "openrouter-gpt-4o", model: "gpt-4o" },
        harness: { id: "llmbench" },
        toolset: { id: "builtin" },
      },
      credential: {
        profileId: credential.id,
        provider: "openrouter",
        sealed: { ciphertext: "A".repeat(68) },
      },
    });
    await database.db
      .update(jobRows)
      .set({ execution: null })
      .where(eq(jobRows.id, jobId));
    await expect(controlPlane.dashboard.retryJob(actor, jobId)).rejects.toThrow(
      "Legacy jobs without an execution snapshot cannot retry.",
    );
  });

  it("keeps hosted credentials out of native target jobs and leases", async () => {
    const { actor, runner } = await pairedOnlineRunner("native-owner");
    const credential = await controlPlane.dashboard.saveCredentialProfile(
      actor,
      {
        label: "OpenRouter native input",
        provider: "openrouter",
        runnerId: runner.id,
        maskedSecret: "••••tive",
        sealedCredential: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: runner.id,
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "A".repeat(68),
        },
      },
    );
    const launched = await controlPlane.dashboard.launchExperiment(actor, {
      name: "Native credential isolation",
      runnerId: runner.id,
      credentialProfileId: credential.id,
      spendConfirmed: true,
      modelRoutes: [
        { id: "openrouter-gpt-4o", provider: "openrouter", model: "gpt-4o" },
      ],
      harnesses: [
        {
          id: "codex",
          version: "1.0.0",
          capabilities: ["response_generation", "workspaces", "files"],
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
        { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    });
    const [nativeJob] = await database.db
      .select()
      .from(jobRows)
      .where(eq(jobRows.experimentId, launched.id));
    if (!nativeJob) throw new Error("Expected native target job.");
    expect(nativeJob.credentialProfileId).toBeNull();

    // Defend leases written before native-target credential isolation landed.
    await database.db
      .update(jobRows)
      .set({ credentialProfileId: credential.id })
      .where(eq(jobRows.id, nativeJob.id));
    const lease = await createRunnerJobService({
      store: new PostgresRunnerJobStore(database.db),
    }).lease(runner);
    expect(lease).toMatchObject({
      jobId: nativeJob.id,
      execution: { credential: null },
    });
  });

  it("previews and launches native-only experiments without a hosted credential", async () => {
    const { actor, runner } = await pairedOnlineRunner("native-no-credential");
    const matrix = {
      name: "Native auth only",
      runnerId: runner.id,
      modelRoutes: [
        { id: "native-model", provider: "native", model: "native/model" },
      ],
      harnesses: [
        {
          id: "codex",
          version: "1.0.0",
          capabilities: [
            "response_generation",
            "workspaces",
            "files",
          ] as Capability[],
          modelRoutes: [
            {
              id: "native-model",
              provider: "native",
              model: "native/model",
            },
          ],
        },
      ],
      toolsets: [
        { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    };

    await expect(
      controlPlane.dashboard.previewExperiment(actor, {
        ...matrix,
        modelRoutes: [
          {
            id: "openrouter-gpt-4o",
            provider: "openrouter",
            model: "gpt-4o",
          },
        ],
        harnesses: [
          {
            id: "llmbench",
            version: "1.0.0",
            capabilities: ["response_generation", "workspaces", "files"],
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
          {
            id: "builtin",
            version: "1.0.0",
            tools: [...LLMBENCH_REPOSITORY_TOOLS],
            mcpProfiles: [],
          },
        ],
      }),
    ).rejects.toThrow("Credential profile is required for LLMBench targets.");

    await expect(
      controlPlane.dashboard.previewExperiment(actor, matrix),
    ).resolves.toMatchObject({ canLaunch: true });
    const launched = await controlPlane.dashboard.launchExperiment(actor, {
      ...matrix,
      spendConfirmed: true,
    });
    const [job] = await database.db
      .select()
      .from(jobRows)
      .where(eq(jobRows.experimentId, launched.id));
    expect(job).toMatchObject({
      credentialProfileId: null,
      execution: { credential: null },
    });
  });

  it("blocks native preview and durable claim when the runner CLI is unavailable", async () => {
    const { actor, runner } = await pairedOnlineRunner("native-preflight", {
      fixture: "1.0.0",
    });
    const matrix = {
      name: "Unavailable native CLI",
      runnerId: runner.id,
      modelRoutes: [{ id: "codex-model", provider: "codex", model: "gpt-5.4" }],
      harnesses: [
        {
          id: "codex",
          version: "1.0.0",
          capabilities: [
            "response_generation",
            "workspaces",
            "files",
          ] as Capability[],
          modelRoutes: [
            { id: "codex-model", provider: "codex", model: "gpt-5.4" },
          ],
        },
      ],
      toolsets: [
        { id: "native", version: "1.0.0", tools: [], mcpProfiles: [] },
      ],
    };

    await expect(
      controlPlane.dashboard.previewExperiment(actor, matrix),
    ).resolves.toMatchObject({
      canLaunch: false,
      blockers: ["Runner does not advertise an installed codex CLI."],
    });

    await database.db
      .update(runnerRows)
      .set({
        environment: {
          ...runner.environment,
          harnessVersions: { codex: "0.142.1" },
        },
      })
      .where(eq(runnerRows.id, runner.id));
    const launched = await controlPlane.dashboard.launchExperiment(actor, {
      ...matrix,
      spendConfirmed: true,
    });
    await database.db
      .update(runnerRows)
      .set({
        environment: {
          ...runner.environment,
          harnessVersions: { fixture: "1.0.0" },
        },
      })
      .where(eq(runnerRows.id, runner.id));

    await expect(
      createRunnerJobService({
        store: new PostgresRunnerJobStore(database.db),
      }).lease({
        ...runner,
        environment: {
          ...runner.environment,
          harnessVersions: { fixture: "1.0.0" },
        },
      }),
    ).resolves.toBeNull();
    await expect(
      database.db
        .select({ status: jobRows.status })
        .from(jobRows)
        .where(eq(jobRows.experimentId, launched.id)),
    ).resolves.toEqual([{ status: "failed" }]);
  });
});

async function pairedOnlineRunner(
  login: string,
  harnessVersions: Record<string, string> = {
    fixture: "1.0.0",
    codex: "0.142.1",
    claude: "2.1.198",
  },
) {
  const pair = await pairedOfflineRunner(login, harnessVersions);
  await heartbeatRunner(pair.runner);
  return pair;
}

async function pairedOfflineRunner(
  login: string,
  harnessVersions: Record<string, string> = {
    fixture: "1.0.0",
    codex: "0.142.1",
    claude: "2.1.198",
  },
) {
  const user = await controlPlane.users.upsertGitHubIdentity({
    githubId: randomUUID(),
    githubLogin: login,
    name: login,
  });
  const actor = { userId: user.id, githubLogin: login, isAdmin: false };
  const runner = await pairRunnerForActor(actor, login, harnessVersions);
  return { actor, runner };
}

async function pairRunnerForActor(
  actor: { userId: string; githubLogin: string; isAdmin: boolean },
  name: string,
  harnessVersions: Record<string, string> = {
    fixture: "1.0.0",
    codex: "0.142.1",
    claude: "2.1.198",
  },
) {
  const protocol = createRunnerProtocolService({
    store: new PostgresRunnerProtocolStore(database.db),
    randomToken: () => randomUUID(),
  });
  const pairing = await protocol.startPairing({
    protocolVersion: "2.0",
    name: `${name} runner`,
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    capabilities: ["response_generation", "workspaces", "files"],
    environment: {
      os: "linux",
      architecture: "arm64",
      cpuClass: "fixture",
      memoryMb: 8192,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions,
      sandboxMode: "process",
      contentHashes: {},
    },
  });
  await protocol.approvePairing(actor, pairing.userCode);
  const approved = await protocol.pollPairing(pairing.deviceCode);
  if (approved.status !== "approved") throw new Error("Expected approval.");
  const runner = await protocol.authenticate(approved.token);
  return runner;
}

async function heartbeatRunner(
  runner: Awaited<ReturnType<typeof pairedOfflineRunner>>["runner"],
) {
  const protocol = createRunnerProtocolService({
    store: new PostgresRunnerProtocolStore(database.db),
  });
  await protocol.heartbeat(runner);
}
