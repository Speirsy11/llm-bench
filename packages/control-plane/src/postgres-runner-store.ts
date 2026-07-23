import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type {
  Capability,
  RunnerCheckpoint,
  RunnerExecution,
  RunnerTerminalRequest,
} from "@llm-bench/contracts";
import {
  LLMBENCH_REPOSITORY_TOOLS,
  RUNNER_PROTOCOL_VERSION,
  RunnerExecutionSchema,
  RunnerPairingStartRequestSchema,
  targetCompatibilityBlockers,
} from "@llm-bench/contracts";

import type {
  QueuedRunnerJob,
  RunnerAttempt,
  RunnerJobStore,
  StoredRunnerEvent,
} from "./runner-jobs";
import type {
  PairedRunner,
  RunnerPairingRecord,
  RunnerProtocolStore,
} from "./runner-protocol";
import type * as schemaType from "./schema";
import {
  metricDefinitionForId,
  primaryMetricIdForBenchmark,
} from "./benchmark-registry";
import {
  artifacts,
  attempts,
  experiments,
  jobs,
  metrics,
  results,
  runnerEvents,
  runnerPairings,
  runners,
} from "./schema";

type Database = PostgresJsDatabase<typeof schemaType>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class PostgresRunnerProtocolStore implements RunnerProtocolStore {
  constructor(private readonly db: Database) {}

  async savePairing(record: RunnerPairingRecord): Promise<void> {
    const values = {
      deviceCodeHash: record.deviceCodeHash,
      userCodeHash: record.userCodeHash,
      request: record.request,
      expiresAt: record.expiresAt,
      ownerId: record.ownerId,
      runnerId: record.runnerId,
      consumedAt: null,
    };
    await this.db.insert(runnerPairings).values(values);
  }

  async findPairingByUserCodeHash(
    userCodeHash: string,
  ): Promise<RunnerPairingRecord | null> {
    const row = await this.db.query.runnerPairings.findFirst({
      where: and(
        eq(runnerPairings.userCodeHash, userCodeHash),
        sql`${runnerPairings.request}->>'protocolVersion' = ${RUNNER_PROTOCOL_VERSION}`,
      ),
    });
    return row ? pairingFromRow(row) : null;
  }

  async findPairingByDeviceHash(
    deviceCodeHash: string,
  ): Promise<RunnerPairingRecord | null> {
    const row = await this.db.query.runnerPairings.findFirst({
      where: and(
        eq(runnerPairings.deviceCodeHash, deviceCodeHash),
        sql`${runnerPairings.request}->>'protocolVersion' = ${RUNNER_PROTOCOL_VERSION}`,
      ),
    });
    return row ? pairingFromRow(row) : null;
  }

  async findRunnerByTokenHash(tokenHash: string): Promise<PairedRunner | null> {
    const row = await this.db.query.runners.findFirst({
      where: and(
        eq(runners.tokenHash, tokenHash),
        eq(runners.protocolVersion, RUNNER_PROTOCOL_VERSION),
      ),
    });
    return row ? runnerFromRow(row) : null;
  }

  async findRunnerById(runnerId: string): Promise<PairedRunner | null> {
    const row = await this.db.query.runners.findFirst({
      where: and(
        eq(runners.id, runnerId),
        eq(runners.protocolVersion, RUNNER_PROTOCOL_VERSION),
      ),
    });
    return row ? runnerFromRow(row) : null;
  }

  async revokeRunner(runnerId: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(runners)
      .set({ revokedAt, status: "disabled" })
      .where(eq(runners.id, runnerId));
  }

  async recordHeartbeat(runnerId: string, lastSeenAt: Date): Promise<void> {
    await this.db
      .update(runners)
      .set({ status: "online", lastSeenAt })
      .where(
        and(
          eq(runners.id, runnerId),
          eq(runners.protocolVersion, RUNNER_PROTOCOL_VERSION),
          isNull(runners.revokedAt),
        ),
      );
  }

  async approvePairing(
    pairing: RunnerPairingRecord,
    runner: PairedRunner,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await transaction.insert(runners).values({
        id: runner.id,
        ownerId: runner.ownerId,
        name: runner.name,
        publicKey: runner.publicKey,
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        capabilities: runner.capabilities,
        environment: runner.environment,
      });
      const claimed = await transaction
        .update(runnerPairings)
        .set({ ownerId: pairing.ownerId, runnerId: runner.id })
        .where(
          and(
            eq(runnerPairings.deviceCodeHash, pairing.deviceCodeHash),
            sql`${runnerPairings.ownerId} is null`,
            sql`${runnerPairings.expiresAt} > now()`,
          ),
        )
        .returning({ deviceCodeHash: runnerPairings.deviceCodeHash });
      if (claimed.length === 0) {
        await transaction.delete(runners).where(eq(runners.id, runner.id));
        return false;
      }
      return true;
    });
  }

  async consumePairing(
    pairing: RunnerPairingRecord,
    runner: PairedRunner,
    consumedAt: Date,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const consumed = await transaction
        .update(runnerPairings)
        .set({ consumedAt })
        .where(
          and(
            eq(runnerPairings.deviceCodeHash, pairing.deviceCodeHash),
            eq(runnerPairings.runnerId, runner.id),
            isNull(runnerPairings.consumedAt),
            gt(runnerPairings.expiresAt, consumedAt),
          ),
        )
        .returning({ deviceCodeHash: runnerPairings.deviceCodeHash });
      if (consumed.length === 0) return false;
      await transaction
        .update(runners)
        .set({ tokenHash: runner.tokenHash })
        .where(eq(runners.id, runner.id));
      return true;
    });
  }
}

export class PostgresRunnerJobStore implements RunnerJobStore {
  constructor(private readonly db: Database) {}

  async enqueue(job: QueuedRunnerJob): Promise<void> {
    if (!job.experimentId || !job.targetId) {
      throw new Error("Persisted jobs require an experiment and target.");
    }
    const execution = parsePersistedExecution(job.execution);
    await this.db.insert(jobs).values({
      id: job.id,
      experimentId: job.experimentId,
      targetId: job.targetId,
      runnerId: job.assignedRunnerId,
      credentialProfileId: execution.credential?.profileId ?? null,
      benchmarkId: job.benchmark.id,
      benchmarkVersion: job.benchmark.version,
      execution,
      workload: execution.workload,
      limits: execution.limits,
      requiredCapabilities: job.requiredCapabilities,
      status: job.status,
      cancellationRequested: job.cancellationRequested,
      retryOfJobId: job.retryOfJobId,
    });
  }

  async claimNext({
    runner,
    attemptId,
    leaseTokenHash,
  }: Parameters<RunnerJobStore["claimNext"]>[0]) {
    return this.db.transaction(async (transaction) => {
      const [lockedRunner] = await transaction
        .select({
          id: runners.id,
          revokedAt: runners.revokedAt,
          status: runners.status,
        })
        .from(runners)
        .where(eq(runners.id, runner.id))
        .for("update");
      const runnerCanClaim =
        lockedRunner?.revokedAt === null && lockedRunner.status !== "disabled";
      if (!runnerCanClaim) return null;

      const active = await transaction
        .select({ id: attempts.id })
        .from(attempts)
        .where(
          and(
            eq(attempts.runnerId, runner.id),
            inArray(attempts.status, [
              "leased",
              "preparing",
              "running",
              "grading",
              "uploading",
            ]),
          ),
        )
        .limit(1);
      if (active.length > 0) return null;

      const skippedJobIds: string[] = [];
      while (true) {
        const [candidate] = await transaction
          .select({ job: jobs })
          .from(jobs)
          .innerJoin(experiments, eq(experiments.id, jobs.experimentId))
          .where(
            and(
              eq(jobs.status, "queued"),
              eq(experiments.ownerId, runner.ownerId),
              or(isNull(jobs.runnerId), eq(jobs.runnerId, runner.id)),
              sql`${jobs.requiredCapabilities} <@ ${JSON.stringify(runner.capabilities)}::jsonb`,
              skippedJobIds.length > 0
                ? notInArray(jobs.id, skippedJobIds)
                : undefined,
            ),
          )
          .orderBy(asc(jobs.queuePosition))
          .limit(1)
          .for("update", { of: jobs, skipLocked: true });
        if (!candidate) return null;

        let execution: RunnerExecution;
        try {
          execution = parsePersistedExecution(candidate.job.execution);
          if (!candidate.job.benchmarkId || !candidate.job.benchmarkVersion) {
            throw new Error("Queued job is missing benchmark metadata.");
          }
          if (
            targetCompatibilityBlockers(
              execution.target,
              candidate.job.requiredCapabilities as Capability[],
              LLMBENCH_REPOSITORY_TOOLS,
              runner.environment.harnessVersions,
            ).length > 0
          ) {
            throw new Error("Queued job target is incompatible.");
          }
        } catch {
          await transaction
            .update(jobs)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(jobs.id, candidate.job.id));
          continue;
        }
        if (!executionCanRunOnRunner(execution, runner)) {
          skippedJobIds.push(candidate.job.id);
          continue;
        }

        const countRows = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(attempts)
          .where(eq(attempts.jobId, candidate.job.id));
        // COUNT always returns exactly one row.
        const count = (countRows as [{ count: number }])[0].count;
        await transaction
          .update(jobs)
          .set({
            status: "leased",
            runnerId: runner.id,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, candidate.job.id));
        const attemptRows = await transaction
          .insert(attempts)
          .values({
            id: attemptId,
            jobId: candidate.job.id,
            number: count + 1,
            status: "leased",
            runnerId: runner.id,
            leaseTokenHash,
          })
          .returning();
        // INSERT ... RETURNING always returns the inserted attempt.
        const insertedAttempt = (
          attemptRows as [typeof attempts.$inferSelect]
        )[0];
        return {
          job: jobFromRow(
            {
              ...candidate.job,
              status: "leased",
              runnerId: runner.id,
            },
            runner.ownerId,
            execution,
          ),
          attempt: attemptFromRow(insertedAttempt),
        };
      }
    });
  }

  async findAttempt(attemptId: string): Promise<RunnerAttempt | null> {
    const row = await this.db.query.attempts.findFirst({
      where: eq(attempts.id, attemptId),
    });
    return row ? attemptFromRow(row) : null;
  }

  async findJob(jobId: string): Promise<QueuedRunnerJob | null> {
    const [row] = await this.db
      .select({
        job: jobs,
        ownerId: experiments.ownerId,
      })
      .from(jobs)
      .innerJoin(experiments, eq(experiments.id, jobs.experimentId))
      .where(eq(jobs.id, jobId))
      .limit(1);
    return row ? jobFromRow(row.job, row.ownerId) : null;
  }

  async markRunning(attemptId: string, jobId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      await transaction
        .update(attempts)
        .set({ status: "running" })
        .where(and(eq(attempts.id, attemptId), eq(attempts.status, "leased")));
      await transaction
        .update(jobs)
        .set({ status: "running", updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, "leased")));
    });
  }

  async complete(
    attemptId: string,
    jobId: string,
    status: RunnerAttempt["status"],
    terminal: RunnerAttempt["terminal"],
  ): Promise<void> {
    const activeStatuses = [
      "leased",
      "preparing",
      "running",
      "grading",
      "uploading",
    ] as const;
    await this.db.transaction(async (transaction) => {
      const updatedAttempts = await transaction
        .update(attempts)
        .set({ status, terminal, finishedAt: new Date() })
        .where(
          and(
            eq(attempts.id, attemptId),
            inArray(attempts.status, activeStatuses),
          ),
        )
        .returning();
      await transaction
        .update(jobs)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(jobs.id, jobId), inArray(jobs.status, activeStatuses)));
      if (updatedAttempts.length === 0 || !terminal) return;
      await persistTerminalResult(transaction, jobId, attemptId, terminal);
    });
  }

  async saveCheckpoint(
    attemptId: string,
    checkpoint: RunnerCheckpoint,
  ): Promise<boolean> {
    const updated = await this.db
      .update(attempts)
      .set({ checkpoint })
      .where(
        and(
          eq(attempts.id, attemptId),
          inArray(attempts.status, [
            "leased",
            "preparing",
            "running",
            "grading",
            "uploading",
          ]),
          or(
            isNull(attempts.checkpoint),
            sql`(${attempts.checkpoint}->>'sequence')::int < ${checkpoint.sequence}`,
          ),
        ),
      )
      .returning({ id: attempts.id });
    return updated.length === 1;
  }

  async setCancellation(jobId: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ cancellationRequested: true, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, jobId),
          inArray(jobs.status, [
            "queued",
            "leased",
            "preparing",
            "running",
            "grading",
            "uploading",
          ]),
        ),
      );
  }

  async saveEvent(event: StoredRunnerEvent): Promise<void> {
    await this.db
      .insert(runnerEvents)
      .values(event)
      .onConflictDoNothing({
        target: [runnerEvents.attemptId, runnerEvents.sequence],
      });
  }
}

function pairingFromRow(
  row: typeof runnerPairings.$inferSelect,
): RunnerPairingRecord {
  return {
    deviceCodeHash: row.deviceCodeHash,
    userCodeHash: row.userCodeHash,
    request: RunnerPairingStartRequestSchema.parse(row.request),
    expiresAt: row.expiresAt,
    ownerId: row.ownerId,
    runnerId: row.runnerId,
    consumed: row.consumedAt !== null,
  };
}

async function persistTerminalResult(
  transaction: Transaction,
  jobId: string,
  attemptId: string,
  terminal: NonNullable<RunnerAttempt["terminal"]>,
): Promise<void> {
  if (
    terminal.status !== "completed" &&
    terminal.observations.length === 0 &&
    terminal.artifacts.length === 0
  ) {
    return;
  }
  const [job] = await transaction
    .select()
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job?.benchmarkId || !job.benchmarkVersion) {
    throw new Error("Completed job is missing benchmark metadata.");
  }
  const primaryMetricId = primaryMetricIdForBenchmark(job.benchmarkId);
  const [insertedResult] = await transaction
    .insert(results)
    .values({
      attemptId,
      benchmarkId: job.benchmarkId,
      benchmarkVersion: job.benchmarkVersion,
      primaryMetricId,
      summary: { status: terminal.status, error: terminal.error },
    })
    .onConflictDoNothing({ target: results.attemptId })
    .returning();
  let result = insertedResult;
  if (result === undefined) {
    const [existingResult] = await transaction
      .select()
      .from(results)
      .where(eq(results.attemptId, attemptId))
      .limit(1);
    if (existingResult === undefined) {
      throw new Error("Completed job result was not persisted.");
    }
    result = existingResult;
  }
  for (const observation of terminal.observations) {
    const definition = metricDefinitionForId(observation.metricId);
    await transaction
      .insert(metrics)
      .values({
        resultId: result.id,
        metricId: observation.metricId,
        kind: definition.kind,
        unit: definition.unit,
        direction: definition.direction,
        value: observation.value,
      })
      .onConflictDoNothing({
        target: [metrics.resultId, metrics.metricId],
      });
  }
  if (terminal.artifacts.length > 0) {
    await transaction
      .insert(artifacts)
      .values(
        terminal.artifacts.map((artifact) => ({
          resultId: result.id,
          kind: artifact.kind,
          blobPath: artifact.blobPath,
          contentHash: artifact.contentHash,
          byteLength: artifact.byteLength,
        })),
      )
      .onConflictDoNothing({
        target: [artifacts.resultId, artifacts.contentHash],
      });
  }
}

function runnerFromRow(row: typeof runners.$inferSelect): PairedRunner {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    publicKey: row.publicKey,
    capabilities: row.capabilities as unknown as Capability[],
    environment: row.environment as PairedRunner["environment"],
    tokenHash: row.tokenHash ?? "",
    revokedAt: row.revokedAt,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
  };
}

function jobFromRow(
  row: typeof jobs.$inferSelect,
  ownerId: string,
  execution = parsePersistedExecution(row.execution),
): QueuedRunnerJob {
  if (!row.benchmarkId || !row.benchmarkVersion) {
    throw new Error("Queued job is missing benchmark metadata.");
  }
  return {
    id: row.id,
    ownerId,
    benchmark: { id: row.benchmarkId, version: row.benchmarkVersion },
    requiredCapabilities: row.requiredCapabilities as Capability[],
    execution,
    status: row.status,
    position: row.queuePosition,
    assignedRunnerId: row.runnerId,
    cancellationRequested: row.cancellationRequested,
    experimentId: row.experimentId,
    targetId: row.targetId,
    retryOfJobId: row.retryOfJobId,
  };
}

function parsePersistedExecution(value: unknown): RunnerExecution {
  const execution = RunnerExecutionSchema.parse(value);
  if (execution.target.harness.id === "llmbench" && !execution.credential) {
    throw new Error("LLMBench execution requires a sealed credential.");
  }
  if (execution.target.harness.id !== "llmbench" && execution.credential) {
    throw new Error(
      "Native harness execution must not reference a hosted credential.",
    );
  }
  return execution;
}

function executionCanRunOnRunner(
  execution: RunnerExecution,
  runner: PairedRunner,
): boolean {
  if (execution.target.harness.id !== "llmbench") return true;
  return (
    execution.credential?.sealed.runnerId === runner.id &&
    execution.credential.provider === execution.target.modelRoute.provider
  );
}

function attemptFromRow(row: typeof attempts.$inferSelect): RunnerAttempt {
  if (!row.runnerId || !row.leaseTokenHash) {
    throw new Error("Runner attempt is missing lease metadata.");
  }
  return {
    id: row.id,
    jobId: row.jobId,
    runnerId: row.runnerId,
    leaseTokenHash: row.leaseTokenHash,
    status: row.status,
    checkpoint: row.checkpoint as RunnerCheckpoint | null,
    terminal: row.terminal as Omit<
      RunnerTerminalRequest,
      "protocolVersion" | "leaseToken"
    > | null,
  };
}
