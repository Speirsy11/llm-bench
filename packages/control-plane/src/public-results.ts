import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import type {
  MetricDirection,
  MetricKind,
  RunnerEnvironment,
  RunnerExecution,
} from "@llm-bench/contracts";
import {
  MetricDirectionSchema,
  MetricKindSchema,
  RunnerEnvironmentSchema,
  RunnerExecutionSchema,
} from "@llm-bench/contracts";

import type { AuthContext } from "./access-policy";
import type * as schemaType from "./schema";
import {
  benchmarkDefinitionForId,
  limitsForBenchmark,
  metricDefinitionForId,
  workloadForBenchmark,
} from "./benchmark-registry";
import {
  artifacts,
  attempts,
  experiments,
  jobs,
  metrics,
  results,
  runners,
} from "./schema";

type Database = PostgresJsDatabase<typeof schemaType>;

/** Reads a private artifact at the curation boundary. */
export abstract class PublicArtifactReader {
  abstract read(pathname: string): Promise<Uint8Array>;
}

export interface PublicExperimentSource {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly curatedAt: Date;
  readonly jobs: readonly PublicResultJobSource[];
}

export interface PublicResultJobSource {
  readonly id: string;
  readonly createdAt: Date;
  readonly status:
    | "queued"
    | "leased"
    | "preparing"
    | "running"
    | "grading"
    | "uploading"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  readonly benchmarkId: string;
  readonly benchmarkVersion: string;
  readonly execution: RunnerExecution;
  readonly runnerEnvironment: RunnerEnvironment;
  readonly result: {
    readonly id: string;
    readonly primaryMetricId: string | null;
    readonly createdAt: Date;
    readonly metrics: readonly {
      readonly id: string;
      readonly kind: MetricKind;
      readonly unit: string;
      readonly direction: MetricDirection;
      readonly value: number | null;
    }[];
    readonly artifactCount: number;
    readonly artifactSummary?: {
      readonly kinds: readonly string[];
      readonly totalBytes: number;
    };
    readonly samples: readonly PublicSample[];
  } | null;
}

export interface PublicSample {
  readonly index: number;
  readonly observations: readonly {
    readonly metricId: string;
    readonly value: number;
  }[];
}

export interface PublicMetricValue {
  readonly id: string;
  readonly label: string;
  readonly kind: MetricKind;
  readonly unit: string;
  readonly direction: MetricDirection;
  readonly value: number | null;
  readonly missing: boolean;
}

export interface PublicTarget {
  readonly model: {
    readonly provider: string;
    readonly id: string;
  };
  readonly harness: {
    readonly id: string;
    readonly version: string;
  };
  readonly toolset: {
    readonly id: string;
    readonly version: string;
    readonly tools: readonly string[];
    readonly mcpProfiles: readonly {
      readonly id: string;
      readonly version: string;
    }[];
  };
}

export interface PublicRunnerEnvironment {
  readonly os: RunnerEnvironment["os"];
  readonly architecture: string;
  readonly cpuClass: string;
  readonly memoryMb: number;
  readonly runtimeVersions: Readonly<Record<string, string>>;
  readonly harnessVersions: Readonly<Record<string, string>>;
  readonly sandboxMode: string;
}

export interface PublicResultSeries {
  readonly id: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly label: string;
  readonly target: PublicTarget;
  readonly primaryMetric: PublicMetricValue;
  readonly metrics: readonly PublicMetricValue[];
  readonly artifactSummary: {
    readonly withheldCount: number;
    readonly kinds: readonly string[];
    readonly totalBytes: number;
  };
  readonly samples: readonly PublicSample[];
  readonly sampleCount: number;
  readonly status: PublicResultJobSource["status"];
  readonly rank: number | null;
}

export interface PublicComparisonGroup {
  readonly key: string;
  readonly benchmark: {
    readonly id: string;
    readonly version: string;
    readonly caseId: string;
    readonly language: string | null;
  };
  readonly environment: PublicRunnerEnvironment;
  readonly comparison: {
    readonly changedDimensions: readonly ("model" | "harness" | "toolset")[];
    readonly rankingEligible: boolean;
  };
  readonly warnings: readonly string[];
  readonly series: readonly PublicResultSeries[];
}

export interface PublicExperimentView {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly curatedAt: string;
  readonly comparisonGroups: readonly PublicComparisonGroup[];
  readonly languageBreakdown: readonly {
    readonly language: string;
    readonly resultCount: number;
  }[];
  readonly warnings: readonly string[];
  readonly sanitization: {
    readonly withheldArtifactCount: number;
    readonly redactedFields: readonly string[];
    readonly excludedFields: readonly string[];
  };
}

export interface PublicResultSummary {
  readonly id: string;
  readonly name: string;
  readonly benchmarkIds: readonly string[];
  readonly resultCount: number;
  readonly curatedAt: string;
}

export interface PublicCurationPreview {
  readonly canPublish: boolean;
  readonly blockers: readonly string[];
  readonly view: PublicExperimentView | null;
  /**
   * Binds an administrator's approval to every publishable field in `view`
   * except `curatedAt`, which is assigned again at the publication boundary.
   */
  readonly fingerprint: string | null;
}

export interface PrivateAnalysisPreview {
  readonly blockers: readonly string[];
  readonly view: PublicExperimentView | null;
}

const PublicMetricValueSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  kind: MetricKindSchema,
  unit: z.string(),
  direction: MetricDirectionSchema,
  value: z.number().nullable(),
  missing: z.boolean(),
});

const EvidenceObservationSchema = z.strictObject({
  metricId: z.string(),
  value: z.number().nullable(),
});
const EvidenceSampleSchema = z.strictObject({
  phase: z.enum(["warmup", "measured"]),
  index: z.number().int().nonnegative(),
  durationMs: z.number(),
  providerDurationMs: z.number().nullable(),
  ttftMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  throughputTokensPerSecond: z.number().nullable(),
  missingReasons: z.record(z.string(), z.string()),
});
const EvidenceAggregateSchema = z.strictObject({
  availableSampleCount: z.number().int().nonnegative(),
  missingSampleCount: z.number().int().nonnegative(),
  sum: z.number().nullable(),
  mean: z.number().nullable(),
  p50: z.number().nullable(),
  p95: z.number().nullable(),
  variance: z.number().nullable(),
  missingReasons: z.array(z.string()),
});
const ResponseEvidenceSchema = z.strictObject({
  sampleCounts: z.strictObject({
    warmup: z.number().int().nonnegative(),
    measured: z.number().int().positive(),
  }),
  samples: z.array(EvidenceSampleSchema),
  aggregates: z.strictObject({
    durationMs: EvidenceAggregateSchema,
    providerDurationMs: EvidenceAggregateSchema,
    ttftMs: EvidenceAggregateSchema,
    inputTokens: EvidenceAggregateSchema,
    outputTokens: EvidenceAggregateSchema,
    costUsd: EvidenceAggregateSchema,
    throughputTokensPerSecond: EvidenceAggregateSchema,
  }),
  grades: z.array(
    z.strictObject({
      sampleIndex: z.number().int().nonnegative(),
      observations: z.array(EvidenceObservationSchema),
    }),
  ),
  invocations: z.array(
    z.strictObject({
      phase: z.enum(["warmup", "measured"]),
      index: z.number().int().nonnegative(),
      metadata: z.record(z.string(), z.unknown()),
    }),
  ),
});

const PublicTargetSchema = z.strictObject({
  model: z.strictObject({
    provider: z.string(),
    id: z.string(),
  }),
  harness: z.strictObject({
    id: z.string(),
    version: z.string(),
  }),
  toolset: z.strictObject({
    id: z.string(),
    version: z.string(),
    tools: z.array(z.string()),
    mcpProfiles: z.array(
      z.strictObject({
        id: z.string(),
        version: z.string(),
      }),
    ),
  }),
});

const PublicRunnerEnvironmentSchema = z.strictObject({
  os: z.enum(["darwin", "linux"]),
  architecture: z.string(),
  cpuClass: z.string(),
  memoryMb: z.number().int().positive(),
  runtimeVersions: z.record(z.string(), z.string()),
  harnessVersions: z.record(z.string(), z.string()),
  sandboxMode: z.string(),
});

const PublicResultSeriesSchema = z.strictObject({
  id: z.string(),
  jobId: z.string(),
  createdAt: z.iso.datetime(),
  label: z.string(),
  target: PublicTargetSchema,
  primaryMetric: PublicMetricValueSchema,
  metrics: z.array(PublicMetricValueSchema),
  artifactSummary: z.strictObject({
    withheldCount: z.number().int().nonnegative(),
    kinds: z.array(z.string()),
    totalBytes: z.number().int().nonnegative(),
  }),
  samples: z.array(
    z.strictObject({
      index: z.number().int().nonnegative(),
      observations: z.array(
        z.strictObject({
          metricId: z.string(),
          value: z.number(),
        }),
      ),
    }),
  ),
  sampleCount: z.number().int().nonnegative(),
  status: z.enum([
    "queued",
    "leased",
    "preparing",
    "running",
    "grading",
    "uploading",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  rank: z.number().int().positive().nullable(),
});

const PublicComparisonGroupSchema = z.strictObject({
  key: z.string(),
  benchmark: z.strictObject({
    id: z.string(),
    version: z.string(),
    caseId: z.string(),
    language: z.string().nullable(),
  }),
  environment: PublicRunnerEnvironmentSchema,
  comparison: z.strictObject({
    changedDimensions: z.array(z.enum(["model", "harness", "toolset"])),
    rankingEligible: z.boolean(),
  }),
  warnings: z.array(z.string()),
  series: z.array(PublicResultSeriesSchema),
});

const PublicExperimentViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  curatedAt: z.iso.datetime(),
  comparisonGroups: z.array(PublicComparisonGroupSchema),
  languageBreakdown: z.array(
    z.strictObject({
      language: z.string(),
      resultCount: z.number().int().nonnegative(),
    }),
  ),
  warnings: z.array(z.string()),
  sanitization: z.strictObject({
    withheldArtifactCount: z.number().int().nonnegative(),
    redactedFields: z.array(z.string()),
    excludedFields: z.array(z.string()),
  }),
});

export interface PublicResultService {
  previewAnalysis(
    actor: AuthContext,
    experimentId: string,
  ): Promise<PrivateAnalysisPreview | null>;
  previewCuration(
    actor: AuthContext,
    experimentId: string,
  ): Promise<PublicCurationPreview>;
  curate(
    actor: AuthContext,
    experimentId: string,
    expectedFingerprint: string,
  ): Promise<PublicExperimentView>;
  withdraw(actor: AuthContext, experimentId: string): Promise<void>;
  list(): Promise<readonly PublicResultSummary[]>;
  get(experimentId: string): Promise<PublicExperimentView | null>;
}

export function createPublicResultService(
  database: Database,
  options: {
    readonly now?: () => Date;
    readonly artifactReader?: PublicArtifactReader;
  } = {},
): PublicResultService {
  const now = options.now ?? (() => new Date());
  return {
    async previewAnalysis(actor, experimentId) {
      const [owned] = await database
        .select({ snapshot: experiments.publicSnapshot })
        .from(experiments)
        .where(
          and(
            eq(experiments.id, experimentId),
            eq(experiments.ownerId, actor.userId),
          ),
        )
        .limit(1);
      if (!owned) return null;

      const snapshot = validSnapshot(owned.snapshot);
      if (snapshot !== null) return { blockers: [], view: snapshot };

      const preview = await prepareCuration(
        database,
        experimentId,
        now(),
        options.artifactReader,
      );
      return { blockers: preview.blockers, view: preview.view };
    },

    async previewCuration(actor, experimentId) {
      requireAdministrator(actor);
      return prepareCuration(
        database,
        experimentId,
        now(),
        options.artifactReader,
      );
    },

    async curate(actor, experimentId, expectedFingerprint) {
      requireAdministrator(actor);
      const preview = await prepareCuration(
        database,
        experimentId,
        now(),
        options.artifactReader,
      );
      if (!preview.canPublish || preview.view === null) {
        throw new Error(preview.blockers[0]);
      }
      if (
        preview.fingerprint === null ||
        preview.fingerprint !== expectedFingerprint
      ) {
        throw new Error(
          "The sanitized publication preview changed. Review and confirm it again.",
        );
      }
      const snapshot = PublicExperimentViewSchema.parse(preview.view);
      const [published] = await database
        .update(experiments)
        .set({
          visibility: "public",
          curatedAt: new Date(snapshot.curatedAt),
          curatedBy: actor.userId,
          publicSnapshot: structuredClone(snapshot),
          updatedAt: now(),
        })
        .where(
          and(
            eq(experiments.id, experimentId),
            eq(experiments.visibility, "private"),
            isNull(experiments.publicSnapshot),
          ),
        )
        .returning({ id: experiments.id });
      if (!published) {
        throw new Error("Experiment is already published or unavailable.");
      }
      return structuredClone(snapshot);
    },

    async withdraw(actor, experimentId) {
      requireAdministrator(actor);
      const [withdrawn] = await database
        .update(experiments)
        .set({
          visibility: "private",
          updatedAt: now(),
        })
        .where(
          and(
            eq(experiments.id, experimentId),
            eq(experiments.visibility, "public"),
          ),
        )
        .returning({ id: experiments.id });
      if (!withdrawn) throw new Error("Experiment is unavailable.");
    },

    async list() {
      const rows = await database
        .select({
          snapshot: experiments.publicSnapshot,
        })
        .from(experiments)
        .where(
          and(
            eq(experiments.visibility, "public"),
            isNotNull(experiments.publicSnapshot),
          ),
        )
        .orderBy(desc(experiments.curatedAt));
      return rows.flatMap(({ snapshot }) => {
        const view = validSnapshot(snapshot);
        if (view === null) return [];
        return [
          {
            id: view.id,
            name: view.name,
            benchmarkIds: [
              ...new Set(
                view.comparisonGroups.map(({ benchmark }) => benchmark.id),
              ),
            ].sort(),
            resultCount: view.comparisonGroups.reduce(
              (count, group) => count + group.series.length,
              0,
            ),
            curatedAt: view.curatedAt,
          },
        ];
      });
    },

    async get(experimentId) {
      const [row] = await database
        .select({ snapshot: experiments.publicSnapshot })
        .from(experiments)
        .where(
          and(
            eq(experiments.id, experimentId),
            eq(experiments.visibility, "public"),
            isNotNull(experiments.publicSnapshot),
          ),
        )
        .limit(1);
      return validSnapshot(row?.snapshot);
    },
  };
}

interface SanitizationState {
  readonly redactedFields: Set<string>;
}

interface MutableSeries extends Omit<PublicResultSeries, "rank"> {
  rank: number | null;
}

interface GroupCandidate {
  readonly key: string;
  readonly sortKey: string;
  readonly benchmark: PublicComparisonGroup["benchmark"];
  readonly environment: PublicRunnerEnvironment;
  readonly series: MutableSeries[];
}

const incompatibleConditionsWarning =
  "Results with different benchmark versions or runner conditions are shown in separate comparison groups.";
const insufficientSamplesWarning =
  "Rankings require at least two measured samples for every target.";
const incompleteMetricsWarning =
  "Missing primary metrics remain visible and are excluded from ranking.";

const excludedFields = [
  "artifact.blobPath",
  "artifact.contentHash",
  "artifact.unapprovedMetadata",
  "credential",
  "experiment.ownerId",
  "runner.name",
  "runner.publicKey",
  "workload.constraints",
  "workload.fixtureContentHash",
  "workload.graderHash",
  "workload.prompt",
] as const;
const approvedPublicArtifactKinds = new Set(["diff", "response_evidence"]);
const responseTelemetryMetricIds = [
  "duration_ms",
  "provider_duration_ms",
  "ttft_ms",
  "input_tokens",
  "output_tokens",
  "cost_usd",
  "throughput_tokens_per_second",
] as const;
const terminalStatuses = new Set<PublicResultJobSource["status"]>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

async function prepareCuration(
  database: Database,
  experimentId: string,
  curatedAt: Date,
  artifactReader: PublicArtifactReader | undefined,
): Promise<PublicCurationPreview> {
  const experiment = await database.query.experiments.findFirst({
    where: eq(experiments.id, experimentId),
  });
  if (!experiment) return blocked("Experiment is unavailable.");
  if (experiment.publicSnapshot !== null) {
    return blocked(
      "Experiment was already published and cannot be republished.",
    );
  }

  const jobRows = await database.query.jobs.findMany({
    where: eq(jobs.experimentId, experimentId),
    orderBy: asc(jobs.queuePosition),
  });
  if (jobRows.length === 0) {
    return blocked("At least one job is required for curation.");
  }
  if (jobRows.some(({ status }) => !terminalStatuses.has(status))) {
    return blocked("All jobs must be terminal before curation.");
  }

  const attemptRows = await database.query.attempts.findMany({
    where: inArray(
      attempts.jobId,
      jobRows.map(({ id }) => id),
    ),
    orderBy: asc(attempts.number),
  });
  const latestAttempts = new Map<string, (typeof attemptRows)[number]>();
  for (const attempt of attemptRows) latestAttempts.set(attempt.jobId, attempt);
  const latestAttemptIds = [...latestAttempts.values()].map(({ id }) => id);
  const resultRows =
    latestAttemptIds.length === 0
      ? []
      : await database.query.results.findMany({
          where: inArray(results.attemptId, latestAttemptIds),
        });
  if (resultRows.length === 0) {
    return blocked("At least one persisted result is required for curation.");
  }
  const resultIds = resultRows.map(({ id }) => id);
  const [metricRows, artifactRows] = await Promise.all([
    database.query.metrics.findMany({
      where: inArray(metrics.resultId, resultIds),
    }),
    database.query.artifacts.findMany({
      where: inArray(artifacts.resultId, resultIds),
    }),
  ]);
  const runnerIds = [
    ...new Set(
      jobRows
        .map(({ runnerId }) => runnerId)
        .filter((runnerId): runnerId is string => runnerId !== null),
    ),
  ];
  const runnerRows =
    runnerIds.length === 0
      ? []
      : await database.query.runners.findMany({
          where: inArray(runners.id, runnerIds),
        });
  const runnersById = new Map(runnerRows.map((runner) => [runner.id, runner]));
  const resultsByAttemptId = new Map(
    resultRows.map((result) => [result.attemptId, result]),
  );
  const sourceJobs: PublicResultJobSource[] = [];
  const blockers: string[] = [];

  for (const job of jobRows) {
    const parsedExecution = RunnerExecutionSchema.safeParse(job.execution);
    const runner = job.runnerId ? runnersById.get(job.runnerId) : undefined;
    const parsedEnvironment = RunnerEnvironmentSchema.safeParse(
      runner?.environment,
    );
    if (!job.benchmarkId || !job.benchmarkVersion) {
      blockers.push(`Job ${job.id} is missing benchmark metadata.`);
      continue;
    }
    const benchmarkDefinition = benchmarkDefinitionForId(job.benchmarkId);
    if (
      benchmarkDefinition === null ||
      benchmarkDefinition.version !== job.benchmarkVersion
    ) {
      blockers.push(`Job ${job.id} has unapproved benchmark metadata.`);
      continue;
    }
    if (!parsedExecution.success) {
      blockers.push(`Job ${job.id} is missing a valid execution snapshot.`);
      continue;
    }
    const approvedWorkload = workloadForBenchmark(job.benchmarkId);
    const approvedLimits = limitsForBenchmark(job.benchmarkId);
    if (
      approvedWorkload === null ||
      approvedLimits === null ||
      !isDeepStrictEqual(parsedExecution.data.workload, approvedWorkload) ||
      !isDeepStrictEqual(parsedExecution.data.limits, approvedLimits)
    ) {
      blockers.push(`Job ${job.id} has unapproved execution conditions.`);
      continue;
    }
    if (!parsedEnvironment.success) {
      blockers.push(`Job ${job.id} is missing a valid runner environment.`);
      continue;
    }
    const attempt = latestAttempts.get(job.id);
    const result = attempt ? resultsByAttemptId.get(attempt.id) : undefined;
    const resultArtifacts = result
      ? artifactRows.filter((artifact) => artifact.resultId === result.id)
      : [];
    let publicSamples: readonly PublicSample[] = [];
    if (result && parsedExecution.data.workload.kind === "response") {
      const evidenceArtifacts = resultArtifacts.filter(
        ({ kind }) => kind === "response_evidence",
      );
      if (evidenceArtifacts.length !== 1) {
        blockers.push(
          `Job ${job.id} requires exactly one response_evidence artifact.`,
        );
      } else if (!artifactReader) {
        blockers.push(
          `Job ${job.id} response evidence cannot be read for curation.`,
        );
      } else {
        const evidenceArtifact = evidenceArtifacts[0];
        if (evidenceArtifact) {
          try {
            publicSamples = await readPublicSamples(
              artifactReader,
              evidenceArtifact,
              benchmarkDefinition.metrics.map(({ id }) => id),
            );
          } catch {
            blockers.push(
              `Job ${job.id} has malformed or unverifiable response evidence.`,
            );
          }
        }
      }
    }
    const resultMetrics: {
      id: string;
      kind: MetricKind;
      unit: string;
      direction: MetricDirection;
      value: number | null;
    }[] = [];
    if (result) {
      const approvedMetricDefinitions = new Map(
        [
          ...benchmarkDefinition.metrics,
          ...(parsedExecution.data.workload.kind === "response"
            ? responseTelemetryMetricIds.map(metricDefinitionForId)
            : []),
        ].map((definition) => [definition.id, definition]),
      );
      let invalidMetricMetadata = false;
      for (const metric of metricRows.filter(
        ({ resultId }) => resultId === result.id,
      )) {
        const kind = MetricKindSchema.safeParse(metric.kind);
        const direction = MetricDirectionSchema.safeParse(metric.direction);
        const approved = approvedMetricDefinitions.get(metric.metricId);
        if (
          !kind.success ||
          !direction.success ||
          approved === undefined ||
          approved.kind !== kind.data ||
          approved.unit !== metric.unit ||
          approved.direction !== direction.data
        ) {
          invalidMetricMetadata = true;
          break;
        }
        resultMetrics.push({
          id: metric.metricId,
          kind: kind.data,
          unit: metric.unit,
          direction: direction.data,
          value: metric.value,
        });
      }
      if (invalidMetricMetadata) {
        blockers.push(`Result ${result.id} has invalid metric metadata.`);
        continue;
      }
      if (result.primaryMetricId !== benchmarkDefinition.primaryMetric.id) {
        blockers.push(
          `Result ${result.id} has invalid primary metric metadata.`,
        );
        continue;
      }
      if (
        parsedExecution.data.workload.kind === "response" &&
        publicSamples.length > 0 &&
        resultMetrics.some(
          (metric) => !aggregateMatchesSamples(metric, publicSamples),
        )
      ) {
        blockers.push(
          `Result ${result.id} aggregates do not match response evidence.`,
        );
        continue;
      }
    }
    sourceJobs.push({
      id: job.id,
      createdAt: job.createdAt,
      status: job.status,
      benchmarkId: job.benchmarkId,
      benchmarkVersion: job.benchmarkVersion,
      execution: parsedExecution.data,
      runnerEnvironment: parsedEnvironment.data,
      result: result
        ? {
            id: result.id,
            primaryMetricId: result.primaryMetricId,
            createdAt: result.createdAt,
            metrics: resultMetrics,
            artifactCount: resultArtifacts.length,
            artifactSummary: {
              kinds: resultArtifacts.map(({ kind }) => kind),
              totalBytes: resultArtifacts.reduce(
                (total, { byteLength }) => total + byteLength,
                0,
              ),
            },
            samples: publicSamples,
          }
        : null,
    });
  }

  const view = PublicExperimentViewSchema.parse(
    buildPublicExperimentView({
      id: experiment.id,
      name: experiment.name,
      createdAt: experiment.createdAt,
      curatedAt,
      jobs: sourceJobs,
    }),
  );
  if (blockers.length > 0) {
    return {
      canPublish: false,
      blockers,
      view,
      fingerprint: null,
    };
  }
  return {
    canPublish: true,
    blockers: [],
    view,
    fingerprint: fingerprintPublicView(view),
  };
}

function blocked(message: string): PublicCurationPreview {
  return {
    canPublish: false,
    blockers: [message],
    view: null,
    fingerprint: null,
  };
}

function fingerprintPublicView(view: PublicExperimentView): string {
  const stableView = { ...view, curatedAt: null };
  return createHash("sha256").update(stableJson(stableView)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readPublicSamples(
  reader: PublicArtifactReader,
  artifact: {
    readonly blobPath: string;
    readonly contentHash: string;
    readonly byteLength: number;
  },
  allowedGradeMetricIds: readonly string[],
): Promise<readonly PublicSample[]> {
  const bytes = await reader.read(artifact.blobPath);
  if (bytes.byteLength !== artifact.byteLength) {
    throw new Error("Response evidence byte length does not match.");
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== artifact.contentHash) {
    throw new Error("Response evidence content hash does not match.");
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const evidence = ResponseEvidenceSchema.parse(JSON.parse(decoded));
  const measured = evidence.samples.filter(({ phase }) => phase === "measured");
  const warmups = evidence.samples.filter(({ phase }) => phase === "warmup");
  if (
    measured.length !== evidence.sampleCounts.measured ||
    warmups.length !== evidence.sampleCounts.warmup ||
    evidence.grades.length !== evidence.sampleCounts.measured ||
    !hasSequentialIndices(measured) ||
    !hasSequentialIndices(warmups) ||
    !hasSequentialIndices(evidence.grades)
  ) {
    throw new Error("Response evidence sample counts are inconsistent.");
  }

  const allowedGradeMetrics = new Set(allowedGradeMetricIds);
  const grades = new Map(
    evidence.grades.map(({ sampleIndex, observations }) => [
      sampleIndex,
      observations.flatMap(({ metricId, value }) =>
        value !== null &&
        Number.isFinite(value) &&
        allowedGradeMetrics.has(metricId)
          ? [{ metricId, value }]
          : [],
      ),
    ]),
  );

  return measured.map((sample) => {
    const gradeObservations = grades.get(sample.index);
    /* v8 ignore next 3 -- sequential count validation above guarantees this key. */
    if (gradeObservations === undefined) {
      throw new Error("Response evidence grades are inconsistent.");
    }
    return {
      index: sample.index,
      observations: [
        ...gradeObservations.map(({ metricId, value }) => ({
          metricId,
          value,
        })),
        ...publicPerformanceObservations(sample),
      ],
    };
  });
}

function hasSequentialIndices(
  values: readonly { readonly index?: number; readonly sampleIndex?: number }[],
): boolean {
  return values.every(
    (value, expected) => (value.index ?? value.sampleIndex) === expected,
  );
}

function publicPerformanceObservations(
  sample: z.infer<typeof EvidenceSampleSchema>,
): PublicSample["observations"] {
  const candidates = [
    ["duration_ms", sample.durationMs],
    ["provider_duration_ms", sample.providerDurationMs],
    ["ttft_ms", sample.ttftMs],
    ["input_tokens", sample.inputTokens],
    ["output_tokens", sample.outputTokens],
    ["cost_usd", sample.costUsd],
    ["throughput_tokens_per_second", sample.throughputTokensPerSecond],
  ] as const;
  return candidates.flatMap(([metricId, value]) =>
    value === null || !Number.isFinite(value) ? [] : [{ metricId, value }],
  );
}

function aggregateMatchesSamples(
  metric: { readonly id: string; readonly value: number | null },
  samples: readonly PublicSample[],
): boolean {
  const values = samples.flatMap(({ observations }) => {
    const observation = observations.find(
      ({ metricId }) => metricId === metric.id,
    );
    return observation === undefined ? [] : [observation.value];
  });
  if (values.length === 0) return metric.value === null;
  if (metric.value === null) return false;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    Math.abs(mean - metric.value) <=
    Number.EPSILON * Math.max(1, Math.abs(mean), Math.abs(metric.value)) * 8
  );
}

function requireAdministrator(actor: AuthContext): void {
  if (!actor.isAdmin) throw new Error("Administrator access required.");
}

function validSnapshot(value: unknown): PublicExperimentView | null {
  const parsed = PublicExperimentViewSchema.safeParse(value);
  return parsed.success ? structuredClone(parsed.data) : null;
}

/**
 * Builds the immutable, JSON-safe public snapshot used by the showcase.
 * Only explicitly selected fields cross this boundary.
 */
export function buildPublicExperimentView(
  source: PublicExperimentSource,
): PublicExperimentView {
  const sanitization: SanitizationState = { redactedFields: new Set() };
  const groups = new Map<string, GroupCandidate>();
  const languageCounts = new Map<string, number>();
  let withheldArtifactCount = 0;

  for (const job of source.jobs) {
    const candidate = candidateFor(job, sanitization);
    withheldArtifactCount += job.result?.artifactCount ?? 0;
    if (candidate.benchmark.language !== null) {
      languageCounts.set(
        candidate.benchmark.language,
        (languageCounts.get(candidate.benchmark.language) ?? 0) + 1,
      );
    }
    const existing = groups.get(candidate.key);
    if (existing) {
      existing.series.push(...candidate.series);
    } else {
      groups.set(candidate.key, candidate);
    }
  }

  const comparisonGroups = [...groups.values()]
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map(finalizeGroup);

  return {
    schemaVersion: 1,
    id: source.id,
    name: sanitizeText(source.name, "experiment.name", sanitization),
    createdAt: source.createdAt.toISOString(),
    curatedAt: source.curatedAt.toISOString(),
    comparisonGroups,
    languageBreakdown: [...languageCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, resultCount]) => ({ language, resultCount })),
    warnings:
      comparisonGroups.length > 1 ? [incompatibleConditionsWarning] : [],
    sanitization: {
      withheldArtifactCount,
      redactedFields: [...sanitization.redactedFields].sort(),
      excludedFields,
    },
  };
}

function candidateFor(
  job: PublicResultJobSource,
  sanitization: SanitizationState,
): GroupCandidate {
  const { execution, result } = job;
  const workload =
    execution.workload.kind === "response"
      ? {
          caseId: execution.workload.case.id,
          language: null,
          sampleCount: execution.workload.case.repetitions,
        }
      : {
          caseId: execution.workload.task.id,
          language: execution.workload.task.language,
          sampleCount: execution.workload.task.repetitions,
        };
  const environment = sanitizeEnvironment(job.runnerEnvironment, sanitization);
  const benchmark = {
    id: sanitizeText(job.benchmarkId, "benchmark.id", sanitization),
    version: sanitizeText(
      job.benchmarkVersion,
      "benchmark.version",
      sanitization,
    ),
    caseId: sanitizeText(workload.caseId, "benchmark.caseId", sanitization),
    language:
      workload.language === null
        ? null
        : sanitizeText(workload.language, "benchmark.language", sanitization),
  };
  const metrics = (result?.metrics ?? []).map((metric) =>
    publicMetric(metric, sanitization),
  );
  const primaryMetric =
    metrics.find((metric) => metric.id === result?.primaryMetricId) ??
    missingPrimaryMetric(
      result?.primaryMetricId ??
        benchmarkDefinitionForId(job.benchmarkId)?.primaryMetric.id ??
        null,
      sanitization,
    );
  const target = sanitizeTarget(execution, sanitization);
  const artifactKinds = result?.artifactSummary?.kinds ?? [];
  const approvedArtifactKinds = artifactKinds
    .filter((kind) => approvedPublicArtifactKinds.has(kind))
    .map((kind) => (kind === "diff" ? "patch_diff" : kind));
  const samples =
    execution.workload.kind === "response"
      ? publicSamples(result?.samples ?? [], job.benchmarkId)
      : [];
  const key = opaqueComparisonKey({
    benchmark,
    primaryMetric: {
      id: primaryMetric.id,
      kind: primaryMetric.kind,
      unit: primaryMetric.unit,
      direction: primaryMetric.direction,
    },
    environment,
    contentHashes: job.runnerEnvironment.contentHashes,
    executionConditions: {
      workload: execution.workload,
      limits: execution.limits,
      plugin: execution.target.plugin ?? null,
      mcpProfiles: [...execution.target.toolset.mcpProfiles].sort(
        (left, right) =>
          [left.id, left.version, left.contentHash]
            .join("\u0000")
            .localeCompare(
              [right.id, right.version, right.contentHash].join("\u0000"),
            ),
      ),
    },
  });
  return {
    key,
    sortKey: [
      benchmark.id,
      benchmark.version,
      benchmark.caseId,
      benchmark.language ?? "",
      environment.os,
      environment.architecture,
      environment.cpuClass,
    ].join("\u0000"),
    benchmark,
    environment,
    series: [
      {
        id: result?.id ?? job.id,
        jobId: job.id,
        createdAt: (result?.createdAt ?? job.createdAt).toISOString(),
        label: `${target.model.id} · ${target.harness.id} · ${target.toolset.id}`,
        target,
        primaryMetric,
        metrics,
        artifactSummary: {
          withheldCount: result?.artifactCount ?? 0,
          kinds: [
            ...new Set(
              approvedArtifactKinds.map((kind, index) =>
                sanitizeText(
                  kind,
                  `result.artifacts.${index}.kind`,
                  sanitization,
                ),
              ),
            ),
          ].sort(),
          totalBytes:
            approvedArtifactKinds.length === artifactKinds.length
              ? (result?.artifactSummary?.totalBytes ?? 0)
              : 0,
        },
        samples,
        sampleCount:
          result === null
            ? 0
            : execution.workload.kind === "response"
              ? samples.length
              : 1,
        status: job.status,
        rank: null,
      },
    ],
  };
}

function publicSamples(
  samples: readonly PublicSample[],
  benchmarkId: string,
): readonly PublicSample[] {
  const allowedMetricIds = new Set([
    ...(benchmarkDefinitionForId(benchmarkId)?.metrics.map(({ id }) => id) ??
      []),
    "duration_ms",
    "provider_duration_ms",
    "ttft_ms",
    "input_tokens",
    "output_tokens",
    "cost_usd",
    "throughput_tokens_per_second",
  ]);
  return samples.map((sample) => ({
    index: sample.index,
    observations: sample.observations.filter(
      ({ metricId, value }) =>
        allowedMetricIds.has(metricId) && Number.isFinite(value),
    ),
  }));
}

function finalizeGroup(candidate: GroupCandidate): PublicComparisonGroup {
  const changedDimensions = (
    [
      [
        "model",
        (series: MutableSeries) =>
          `${series.target.model.provider}/${series.target.model.id}`,
      ],
      [
        "harness",
        (series: MutableSeries) =>
          `${series.target.harness.id}@${series.target.harness.version}`,
      ],
      [
        "toolset",
        (series: MutableSeries) => toolsetIdentity(series.target.toolset),
      ],
    ] as const
  )
    .filter(([, valueFor]) => {
      return new Set(candidate.series.map(valueFor)).size > 1;
    })
    .map(([dimension]) => dimension);
  const enoughSamples = candidate.series.every(
    ({ sampleCount }) => sampleCount >= 2,
  );
  const completeMetrics = candidate.series.every(
    ({ primaryMetric }) => !primaryMetric.missing,
  );
  const rankingEligible =
    candidate.series.length >= 2 && enoughSamples && completeMetrics;
  if (rankingEligible) assignRanks(candidate.series);

  const warnings: string[] = [];
  if (!enoughSamples) warnings.push(insufficientSamplesWarning);
  if (!completeMetrics) warnings.push(incompleteMetricsWarning);
  if (changedDimensions.length > 1) {
    warnings.push(
      `This comparison changes ${changedDimensions.join(", ")}; interpret it as a configuration comparison, not an isolated variable effect.`,
    );
  }

  return {
    key: candidate.key,
    benchmark: candidate.benchmark,
    environment: candidate.environment,
    comparison: { changedDimensions, rankingEligible },
    warnings,
    series: candidate.series,
  };
}

function toolsetIdentity(toolset: PublicTarget["toolset"]): string {
  return JSON.stringify({
    id: toolset.id,
    version: toolset.version,
    tools: [...toolset.tools].sort(),
    mcpProfiles: [...toolset.mcpProfiles].sort((left, right) =>
      `${left.id}@${left.version}`.localeCompare(
        `${right.id}@${right.version}`,
      ),
    ),
  });
}

function opaqueComparisonKey(value: unknown): string {
  return `comparison-${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16)}`;
}

function assignRanks(series: MutableSeries[]): void {
  const direction = series[0]?.primaryMetric.direction;
  const ranked = [...series].sort((left, right) => {
    const leftValue = Number(left.primaryMetric.value);
    const rightValue = Number(right.primaryMetric.value);
    return direction === "higher_is_better"
      ? rightValue - leftValue
      : leftValue - rightValue;
  });
  let previousValue: number | null = null;
  let previousRank = 0;
  for (const [index, item] of ranked.entries()) {
    const value = item.primaryMetric.value;
    const rank =
      index > 0 && value === previousValue ? previousRank : index + 1;
    item.rank = rank;
    previousValue = value;
    previousRank = rank;
  }
}

function publicMetric(
  metric: NonNullable<PublicResultJobSource["result"]>["metrics"][number],
  sanitization: SanitizationState,
): PublicMetricValue {
  const id = sanitizeText(metric.id, `metric.${metric.id}.id`, sanitization);
  const registered = registeredMetric(id);
  const label =
    registered?.label ??
    id
      .split("_")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  return {
    id,
    label,
    kind: metric.kind,
    unit: sanitizeText(metric.unit, `metric.${metric.id}.unit`, sanitization),
    direction: metric.direction,
    value: metric.value,
    missing: metric.value === null,
  };
}

function registeredMetric(metricId: string) {
  for (const benchmarkId of [
    "repository-repair",
    "structured-output",
    "instruction-following",
    "performance",
  ]) {
    const benchmark = benchmarkDefinitionForId(benchmarkId);
    const metric = benchmark?.metrics.find(({ id }) => id === metricId);
    if (metric) return metric;
  }
  return null;
}

function missingPrimaryMetric(
  metricId: string | null,
  sanitization: SanitizationState,
): PublicMetricValue {
  const id = sanitizeText(
    metricId ?? "primary_metric",
    "metric.primary.id",
    sanitization,
  );
  const registered = registeredMetric(id);
  return {
    id,
    label: registered?.label ?? "Primary metric",
    kind: registered?.kind ?? "count",
    unit: registered?.unit ?? "count",
    direction: registered?.direction ?? "higher_is_better",
    value: null,
    missing: true,
  };
}

function sanitizeTarget(
  execution: RunnerExecution,
  sanitization: SanitizationState,
): PublicTarget {
  return {
    model: {
      provider: sanitizeText(
        execution.target.modelRoute.provider,
        "target.model.provider",
        sanitization,
      ),
      id: sanitizeText(
        execution.target.modelRoute.model,
        "target.model.id",
        sanitization,
      ),
    },
    harness: {
      id: sanitizeText(
        execution.target.harness.id,
        "target.harness.id",
        sanitization,
      ),
      version: sanitizeText(
        execution.target.harness.version,
        "target.harness.version",
        sanitization,
      ),
    },
    toolset: {
      id: sanitizeText(
        execution.target.toolset.id,
        "target.toolset.id",
        sanitization,
      ),
      version: sanitizeText(
        execution.target.toolset.version,
        "target.toolset.version",
        sanitization,
      ),
      tools: execution.target.toolset.tools.map((tool, index) =>
        sanitizeText(tool, `target.toolset.tools.${index}`, sanitization),
      ),
      mcpProfiles: execution.target.toolset.mcpProfiles.map(
        (profile, index) => ({
          id: sanitizeText(
            profile.id,
            `target.toolset.mcpProfiles.${index}.id`,
            sanitization,
          ),
          version: sanitizeText(
            profile.version,
            `target.toolset.mcpProfiles.${index}.version`,
            sanitization,
          ),
        }),
      ),
    },
  };
}

function sanitizeEnvironment(
  environment: RunnerEnvironment,
  sanitization: SanitizationState,
): PublicRunnerEnvironment {
  return {
    os: environment.os,
    architecture: sanitizeText(
      environment.architecture,
      "runner.architecture",
      sanitization,
    ),
    cpuClass: sanitizeText(
      environment.cpuClass,
      "runner.cpuClass",
      sanitization,
    ),
    memoryMb: environment.memoryMb,
    runtimeVersions: sanitizeRecord(
      environment.runtimeVersions,
      "runner.runtimeVersions",
      sanitization,
    ),
    harnessVersions: sanitizeRecord(
      environment.harnessVersions,
      "runner.harnessVersions",
      sanitization,
    ),
    sandboxMode: sanitizeText(
      environment.sandboxMode,
      "runner.sandboxMode",
      sanitization,
    ),
  };
}

function sanitizeRecord(
  record: Readonly<Record<string, string>>,
  field: string,
  sanitization: SanitizationState,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        sanitizeText(key, `${field}.${key}.key`, sanitization),
        sanitizeText(value, `${field}.${key}`, sanitization),
      ]),
  );
}

function sanitizeText(
  value: string,
  field: string,
  sanitization: SanitizationState,
): string {
  let sanitized = value
    .replace(
      /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@[^\s]+/giu,
      "[redacted-secret-url]",
    )
    .replace(
      /(?:\/(?:Users|home)\/[^/\s]+(?:\/[^\s]+)*|[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s]+)*)/gu,
      "[redacted-path]",
    )
    .replace(
      /\b(?:sk|ghp|github_pat|glpat|npm|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/giu,
      "[redacted-secret]",
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, "[redacted-secret]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
      "[redacted-secret]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{6,}\b/giu, "[redacted-secret]")
    .replace(
      /\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key)\s*[:=]\s*[^\s,;]+/giu,
      "[redacted-secret]",
    )
    .replace(/\b[a-f0-9]{32,}\b/giu, "[redacted-secret]");
  if (field === "experiment.name") {
    sanitized = sanitized.replace(
      /\b(?=[A-Za-z0-9+/=_-]{32,}\b)(?=[A-Za-z0-9+/=_-]*[A-Za-z])(?=[A-Za-z0-9+/=_-]*[0-9])[A-Za-z0-9+/=_-]+\b/gu,
      "[redacted-secret]",
    );
  }
  sanitized = sanitized.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    "[redacted-email]",
  );
  if (field === "experiment.name") {
    sanitized = sanitized.replace(
      /(^|[^A-Za-z0-9_./+-])@[A-Za-z0-9_-]+/gu,
      "$1[redacted-user]",
    );
  }
  if (sanitized !== value) sanitization.redactedFields.add(field);
  return sanitized;
}
