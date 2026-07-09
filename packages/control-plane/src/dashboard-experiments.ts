import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type {
  Capability,
  HarnessManifest,
  MetricDirection,
  MetricKind,
  MetricObservation,
  ModelRoute,
  Toolset,
} from "@llm-bench/contracts";

import type { AuthContext } from "./access-policy";
import type { PairedRunner } from "./runner-protocol";
import type * as schemaType from "./schema";
import { repositoryRepairBenchmark } from "./benchmark-registry";
import {
  attempts,
  credentialProfiles,
  experiments,
  jobs,
  metrics,
  results,
  runners,
  targets,
} from "./schema";

type Database = PostgresJsDatabase<typeof schemaType>;

const terminalRetryableStatuses = [
  "failed",
  "cancelled",
  "interrupted",
] as const;

export interface SealedCredentialSnapshot {
  readonly algorithm: "x25519-xsalsa20-poly1305-sealed-box";
  readonly runnerId: string;
  readonly keyFingerprint: string;
  readonly ciphertext: string;
}

export interface SaveCredentialProfileInput {
  readonly label: string;
  readonly provider: string;
  readonly runnerId: string;
  readonly maskedSecret: string;
  readonly sealedCredential: SealedCredentialSnapshot;
}

export interface ExperimentMatrixInput {
  readonly name: string;
  readonly runnerId: string;
  readonly credentialProfileId: string;
  readonly modelRoutes: readonly ModelRoute[];
  readonly harnesses: readonly HarnessManifest[];
  readonly toolsets: readonly Toolset[];
}

export interface LaunchExperimentInput extends ExperimentMatrixInput {
  readonly spendConfirmed: boolean;
}

export interface TargetPreview {
  readonly position: number;
  readonly modelRouteId: string;
  readonly harnessId: string;
  readonly toolsetId: string;
  readonly requiredCapabilities: readonly Capability[];
}

export interface ExperimentPreview {
  readonly input: ExperimentMatrixInput;
  readonly projectedJobCount: number;
  readonly spend: { readonly kind: "unknown" };
  readonly canLaunch: boolean;
  readonly blockers: readonly string[];
  readonly order: readonly TargetPreview[];
}

export interface LaunchedExperiment {
  readonly id: string;
  readonly name: string;
  readonly projectedJobCount: number;
}

export interface DashboardExperimentDetail {
  readonly id: string;
  readonly name: string;
  readonly progress: {
    readonly totalJobs: number;
    readonly queuedJobs: number;
    readonly runningJobs: number;
    readonly completedJobs: number;
    readonly failedJobs: number;
    readonly cancelledJobs: number;
    readonly interruptedJobs: number;
  };
  readonly jobs: readonly DashboardJobDetail[];
}

export interface DashboardJobDetail {
  readonly id: string;
  readonly status: typeof jobs.$inferSelect.status;
  readonly retryOfJobId: string | null;
  readonly cancellationRequested: boolean;
  readonly target: {
    readonly position: number;
    readonly modelRoute: ModelRoute;
    readonly harness: HarnessManifest;
    readonly toolset: Toolset;
  };
  readonly primaryMetric: {
    readonly id: string;
    readonly label: string;
    readonly kind: MetricKind;
    readonly unit: string;
    readonly direction: MetricDirection;
    readonly value: number | null;
  } | null;
}

export type DashboardRunner = Omit<PairedRunner, "tokenHash">;

export function createDashboardExperimentService(db: Database) {
  return {
    async saveCredentialProfile(
      actor: AuthContext,
      input: SaveCredentialProfileInput,
    ) {
      const runner = await requireOwnedRunner(db, actor, input.runnerId);
      if (input.sealedCredential.runnerId !== runner.id) {
        throw new Error("Credential is not sealed for this runner.");
      }
      const profileRows = await db
        .insert(credentialProfiles)
        .values({
          ownerId: actor.userId,
          runnerId: runner.id,
          label: input.label,
          provider: input.provider,
          maskedSecret: input.maskedSecret,
          sealedCredential: clone(input.sealedCredential) as unknown as Record<
            string,
            unknown
          >,
        })
        .returning();
      return (profileRows as [typeof credentialProfiles.$inferSelect])[0];
    },

    async listCredentialProfiles(actor: AuthContext) {
      return db.query.credentialProfiles.findMany({
        where: eq(credentialProfiles.ownerId, actor.userId),
        orderBy: asc(credentialProfiles.createdAt),
      });
    },

    async listRunners(actor: AuthContext): Promise<DashboardRunner[]> {
      const rows = await db.query.runners.findMany({
        where: eq(runners.ownerId, actor.userId),
        orderBy: asc(runners.createdAt),
      });
      return rows.map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        publicKey: row.publicKey,
        capabilities: row.capabilities as Capability[],
        environment: row.environment as PairedRunner["environment"],
        revokedAt: row.revokedAt,
        status: row.status,
        lastSeenAt: row.lastSeenAt,
      }));
    },

    async previewExperiment(
      actor: AuthContext,
      input: ExperimentMatrixInput,
    ): Promise<ExperimentPreview> {
      const normalized = normalizeMatrixInput(input);
      const runner = await requireOwnedRunner(db, actor, normalized.runnerId);
      const credential = await requireOwnedCredentialProfile(
        db,
        actor,
        normalized.credentialProfileId,
      );
      if (credential.runnerId !== runner.id) {
        throw new Error("Credential profile is not sealed for this runner.");
      }

      const order = expandRoundRobin(normalized).map((item, position) => ({
        position,
        modelRouteId: item.modelRoute.id,
        harnessId: item.harness.id,
        toolsetId: item.toolset.id,
        requiredCapabilities: repositoryRepairBenchmark.requiredCapabilities,
      }));
      const blockers = blockersFor(normalized, runner);
      return {
        input: normalized,
        projectedJobCount: order.length,
        spend: { kind: "unknown" },
        canLaunch: blockers.length === 0,
        blockers,
        order,
      };
    },

    async launchExperiment(
      actor: AuthContext,
      input: LaunchExperimentInput,
    ): Promise<LaunchedExperiment> {
      const { spendConfirmed, ...matrix } = input;
      if (!spendConfirmed) throw new Error("Spend confirmation is required.");
      const preview = await this.previewExperiment(actor, matrix);
      if (!preview.canLaunch) {
        throw new Error(
          preview.blockers[0] ?? "Experiment cannot be launched.",
        );
      }
      const targetInputs = expandRoundRobin(preview.input);
      return db.transaction(async (transaction) => {
        const experimentRows = await transaction
          .insert(experiments)
          .values({
            ownerId: actor.userId,
            name: preview.input.name,
            visibility: "private",
            configurationSnapshot: snapshotFor(preview.input, preview.order),
          })
          .returning();
        const experiment = (
          experimentRows as [typeof experiments.$inferSelect]
        )[0];

        for (const [position, item] of targetInputs.entries()) {
          const targetRows = await transaction
            .insert(targets)
            .values({
              experimentId: experiment.id,
              position,
              modelRoute: clone(item.modelRoute),
              harness: clone(item.harness),
              toolset: clone(item.toolset),
            })
            .returning();
          const target = (targetRows as [typeof targets.$inferSelect])[0];
          await transaction.insert(jobs).values({
            experimentId: experiment.id,
            targetId: target.id,
            runnerId: preview.input.runnerId,
            benchmarkId: repositoryRepairBenchmark.id,
            benchmarkVersion: repositoryRepairBenchmark.version,
            requiredCapabilities: [
              ...repositoryRepairBenchmark.requiredCapabilities,
            ],
          });
        }
        return {
          id: experiment.id,
          name: experiment.name,
          projectedJobCount: targetInputs.length,
        };
      });
    },

    async getExperiment(
      actor: AuthContext,
      experimentId: string,
    ): Promise<DashboardExperimentDetail | null> {
      const experiment = await db.query.experiments.findFirst({
        where: and(
          eq(experiments.id, experimentId),
          eq(experiments.ownerId, actor.userId),
        ),
      });
      if (!experiment) return null;
      const targetRows = await db.query.targets.findMany({
        where: eq(targets.experimentId, experiment.id),
        orderBy: asc(targets.position),
      });
      const jobRows = await db.query.jobs.findMany({
        where: eq(jobs.experimentId, experiment.id),
        orderBy: asc(jobs.queuePosition),
      });
      const attemptRows =
        jobRows.length === 0
          ? []
          : await db.query.attempts.findMany({
              where: inArray(
                attempts.jobId,
                jobRows.map((job) => job.id),
              ),
              orderBy: asc(attempts.number),
            });
      const resultRows =
        attemptRows.length === 0
          ? []
          : await db.query.results.findMany({
              where: inArray(
                results.attemptId,
                attemptRows.map((attempt) => attempt.id),
              ),
            });
      const metricRows =
        resultRows.length === 0
          ? []
          : await db.query.metrics.findMany({
              where: inArray(
                metrics.resultId,
                resultRows.map((result) => result.id),
              ),
            });
      const targetsById = new Map(
        targetRows.map((target) => [target.id, target]),
      );
      const attemptsByJobId = latestAttemptsByJobId(attemptRows);
      const resultsByAttemptId = new Map(
        resultRows.map((result) => [result.attemptId, result]),
      );
      const metricsByResultId = new Map(
        resultRows.map((result) => [
          result.id,
          metricRows.filter((metric) => metric.resultId === result.id),
        ]),
      );
      const detailJobs = jobRows.map((job) => {
        const target = targetsById.get(job.targetId);
        if (target === undefined) {
          throw new Error(`Experiment target not found for job ${job.id}.`);
        }
        const attempt = attemptsByJobId.get(job.id) ?? null;
        const result = attempt ? resultsByAttemptId.get(attempt.id) : null;
        return {
          id: job.id,
          status: job.status,
          retryOfJobId: job.retryOfJobId,
          cancellationRequested: job.cancellationRequested,
          target: {
            position: target.position,
            modelRoute: target.modelRoute as ModelRoute,
            harness: target.harness as HarnessManifest,
            toolset: target.toolset as Toolset,
          },
          primaryMetric: primaryMetricFor({
            result: result ?? null,
            metrics: result ? (metricsByResultId.get(result.id) ?? []) : [],
            terminal: attempt?.terminal ?? null,
          }),
        };
      });
      return {
        id: experiment.id,
        name: experiment.name,
        progress: progressFor(detailJobs),
        jobs: detailJobs,
      };
    },

    async listExperiments(actor: AuthContext) {
      const rows = await db.query.experiments.findMany({
        where: eq(experiments.ownerId, actor.userId),
        orderBy: asc(experiments.createdAt),
      });
      const details = await Promise.all(
        rows.map((experiment) => this.getExperiment(actor, experiment.id)),
      );
      return details.filter(
        (detail): detail is DashboardExperimentDetail => detail !== null,
      );
    },

    async cancelJob(actor: AuthContext, jobId: string): Promise<void> {
      const job = await requireOwnedJob(db, actor, jobId);
      await db.transaction(async (transaction) => {
        await transaction
          .update(jobs)
          .set({
            status: "cancelled",
            cancellationRequested: true,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")));

        await transaction
          .update(jobs)
          .set({ cancellationRequested: true, updatedAt: new Date() })
          .where(
            and(
              eq(jobs.id, job.id),
              inArray(jobs.status, [
                "leased",
                "preparing",
                "running",
                "grading",
                "uploading",
              ]),
            ),
          );
      });
    },

    async retryJob(actor: AuthContext, jobId: string) {
      const job = await requireOwnedJob(db, actor, jobId);
      if (!terminalRetryableStatuses.some((status) => status === job.status)) {
        throw new Error("Only terminal unsuccessful jobs can be retried.");
      }
      return db.transaction(async (transaction) => {
        const retryRows = await transaction
          .insert(jobs)
          .values({
            experimentId: job.experimentId,
            targetId: job.targetId,
            runnerId: job.runnerId,
            benchmarkId: job.benchmarkId,
            benchmarkVersion: job.benchmarkVersion,
            requiredCapabilities: job.requiredCapabilities,
            retryOfJobId: job.id,
          })
          .onConflictDoUpdate({
            target: jobs.retryOfJobId,
            targetWhere: sql`${jobs.retryOfJobId} is not null and ${jobs.status} in ('queued', 'leased', 'preparing', 'running', 'grading', 'uploading')`,
            set: { updatedAt: sql`${jobs.updatedAt}` },
          })
          .returning();
        // INSERT ... ON CONFLICT DO UPDATE ... RETURNING yields the inserted
        // retry or the active retry protected by the partial unique index.
        return (retryRows as [typeof jobs.$inferSelect])[0];
      });
    },
  };
}

async function requireOwnedRunner(
  db: Database,
  actor: AuthContext,
  runnerId: string,
) {
  const runner = await db.query.runners.findFirst({
    where: and(eq(runners.id, runnerId), eq(runners.ownerId, actor.userId)),
  });
  if (!runner) throw new Error("Runner is unavailable.");
  return runner;
}

async function requireOwnedCredentialProfile(
  db: Database,
  actor: AuthContext,
  credentialProfileId: string,
) {
  const credential = await db.query.credentialProfiles.findFirst({
    where: and(
      eq(credentialProfiles.id, credentialProfileId),
      eq(credentialProfiles.ownerId, actor.userId),
    ),
  });
  if (!credential) throw new Error("Credential profile is unavailable.");
  return credential;
}

async function requireOwnedJob(
  db: Database,
  actor: AuthContext,
  jobId: string,
) {
  const [row] = await db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(experiments, eq(experiments.id, jobs.experimentId))
    .where(and(eq(jobs.id, jobId), eq(experiments.ownerId, actor.userId)))
    .limit(1);
  if (!row) throw new Error("Job is unavailable.");
  return row.job;
}

function normalizeMatrixInput(
  input: ExperimentMatrixInput,
): ExperimentMatrixInput {
  return {
    name: input.name.trim(),
    runnerId: input.runnerId,
    credentialProfileId: input.credentialProfileId,
    modelRoutes: input.modelRoutes.map(clone),
    harnesses: input.harnesses.map(clone),
    toolsets: input.toolsets.map(clone),
  };
}

function expandRoundRobin(input: ExperimentMatrixInput) {
  const byRoute = input.modelRoutes.map((modelRoute) =>
    input.harnesses.flatMap((harness) =>
      input.toolsets.map((toolset) => ({ modelRoute, harness, toolset })),
    ),
  );
  const maxLength = Math.max(0, ...byRoute.map((items) => items.length));
  const expanded: {
    modelRoute: ModelRoute;
    harness: HarnessManifest;
    toolset: Toolset;
  }[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    for (const routeItems of byRoute) {
      const item = routeItems[index];
      if (item) expanded.push(item);
    }
  }
  return expanded;
}

function blockersFor(
  input: ExperimentMatrixInput,
  runner: typeof runners.$inferSelect,
): string[] {
  const blockers: string[] = [];
  if (input.name.length === 0) blockers.push("Experiment name is required.");
  if (input.modelRoutes.length === 0)
    blockers.push("At least one model route is required.");
  if (input.harnesses.length === 0)
    blockers.push("At least one harness is required.");
  if (input.toolsets.length === 0)
    blockers.push("At least one toolset is required.");
  if (runner.status === "offline") blockers.push("Runner is offline.");
  if (runner.status === "disabled") blockers.push("Runner is disabled.");
  const runnerCapabilities = runner.capabilities as Capability[];
  const runnerMissing = missingCapabilities(
    repositoryRepairBenchmark.requiredCapabilities,
    runnerCapabilities,
  );
  if (runnerMissing.length > 0) {
    blockers.push(`Runner is missing ${runnerMissing.join(", ")}.`);
  }
  for (const harness of input.harnesses) {
    const missing = missingCapabilities(
      repositoryRepairBenchmark.requiredCapabilities,
      harness.capabilities,
    );
    if (missing.length > 0) {
      blockers.push(`${harness.id} is missing ${missing.join(", ")}.`);
    }
    for (const route of input.modelRoutes) {
      if (!harness.modelRoutes.some((candidate) => candidate.id === route.id)) {
        blockers.push(`${harness.id} cannot use ${route.id}.`);
      }
    }
  }
  return blockers;
}

function missingCapabilities(
  required: readonly Capability[],
  advertised: readonly Capability[],
): Capability[] {
  const advertisedSet = new Set(advertised);
  return required.filter((capability) => !advertisedSet.has(capability));
}

function snapshotFor(
  input: ExperimentMatrixInput,
  order: readonly TargetPreview[],
): Record<string, unknown> {
  return clone({
    benchmark: {
      id: repositoryRepairBenchmark.id,
      version: repositoryRepairBenchmark.version,
      primaryMetricId: repositoryRepairBenchmark.primaryMetric.id,
    },
    runnerId: input.runnerId,
    credentialProfileId: input.credentialProfileId,
    modelRoutes: input.modelRoutes,
    harnesses: input.harnesses,
    toolsets: input.toolsets,
    order,
    spend: { kind: "unknown" },
  });
}

function latestAttemptsByJobId(rows: (typeof attempts.$inferSelect)[]) {
  const map = new Map<string, typeof attempts.$inferSelect>();
  for (const row of rows) {
    map.set(row.jobId, row);
  }
  return map;
}

function primaryMetricFor(input: {
  result: typeof results.$inferSelect | null;
  metrics: (typeof metrics.$inferSelect)[];
  terminal: Record<string, unknown> | null;
}): DashboardJobDetail["primaryMetric"] {
  const observed = input.metrics.find(
    (metric) => metric.metricId === repositoryRepairBenchmark.primaryMetric.id,
  );
  if (observed) {
    return {
      ...repositoryRepairBenchmark.primaryMetric,
      value: observed.value,
    };
  }
  const observations = input.terminal?.observations;
  const terminalObservations = (
    Array.isArray(observations) ? (observations as MetricObservation[]) : []
  ).filter(
    (observation) =>
      observation.metricId === repositoryRepairBenchmark.primaryMetric.id,
  );
  const terminalMetric = terminalObservations[0];
  if (!terminalMetric && !input.result) return null;
  return {
    ...repositoryRepairBenchmark.primaryMetric,
    value: terminalMetric?.value ?? null,
  };
}

function progressFor(jobsList: readonly DashboardJobDetail[]) {
  return {
    totalJobs: jobsList.length,
    queuedJobs: jobsList.filter((job) => job.status === "queued").length,
    runningJobs: jobsList.filter((job) =>
      ["leased", "preparing", "running", "grading", "uploading"].includes(
        job.status,
      ),
    ).length,
    completedJobs: jobsList.filter((job) => job.status === "completed").length,
    failedJobs: jobsList.filter((job) => job.status === "failed").length,
    cancelledJobs: jobsList.filter((job) => job.status === "cancelled").length,
    interruptedJobs: jobsList.filter((job) => job.status === "interrupted")
      .length,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
