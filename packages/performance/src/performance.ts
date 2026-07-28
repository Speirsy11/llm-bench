import type {
  MetricDefinition,
  MetricObservation,
  ResponseCase,
} from "@llm-bench/contracts";
import { ResponseBenchmark } from "@llm-bench/contracts";

const PERFORMANCE_CASE_ID = "sentinel-response";

export const performanceMetricDefinitions = [
  {
    id: "duration_ms",
    label: "Harness duration",
    kind: "duration",
    unit: "ms",
    direction: "lower_is_better",
  },
  {
    id: "provider_duration_ms",
    label: "Provider request duration",
    kind: "duration",
    unit: "ms",
    direction: "lower_is_better",
  },
  {
    id: "ttft_ms",
    label: "Time to first token",
    kind: "duration",
    unit: "ms",
    direction: "lower_is_better",
  },
  {
    id: "input_tokens",
    label: "Input tokens",
    kind: "tokens",
    unit: "tokens",
    direction: "lower_is_better",
  },
  {
    id: "output_tokens",
    label: "Output tokens",
    kind: "tokens",
    unit: "tokens",
    direction: "lower_is_better",
  },
  {
    id: "cost_usd",
    label: "Cost",
    kind: "currency",
    unit: "USD",
    direction: "lower_is_better",
  },
  {
    id: "throughput_tokens_per_second",
    label: "Output throughput",
    kind: "rate",
    unit: "tokens/s",
    direction: "higher_is_better",
  },
  {
    id: "exact_response",
    label: "Exact response",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
] as const satisfies readonly MetricDefinition[];

const performanceCases: ResponseCase[] = [
  {
    id: PERFORMANCE_CASE_ID,
    prompt: "Reply with exactly the word READY and nothing else.",
    repetitions: 5,
  },
];

export class PerformanceBenchmark extends ResponseBenchmark {
  constructor() {
    super({
      id: "performance",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: "duration_ms",
      metrics: [...performanceMetricDefinitions],
      requiredCapabilities: ["response_generation"],
    });
  }

  override cases(): ResponseCase[] {
    return structuredClone(performanceCases);
  }

  override grade(caseId: string, response: string): MetricObservation[] {
    if (caseId !== PERFORMANCE_CASE_ID) {
      throw new Error(`Unknown performance case: ${caseId}`);
    }
    return [
      {
        metricId: "exact_response",
        value: response === "READY" ? 1 : 0,
      },
    ];
  }
}

export type SamplePhase = "warmup" | "measured";

export type OptionalPerformanceMetric =
  | "providerDurationMs"
  | "ttftMs"
  | "inputTokens"
  | "outputTokens"
  | "costUsd";

export interface PerformanceSampleContext {
  phase: SamplePhase;
  index: number;
}

export interface PerformanceSampleInput {
  durationMs: number;
  providerDurationMs?: number | null;
  ttftMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  missingReasons?: Partial<Record<OptionalPerformanceMetric, string>>;
}

export interface PerformanceSample {
  phase: SamplePhase;
  index: number;
  durationMs: number;
  providerDurationMs: number | null;
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  throughputTokensPerSecond: number | null;
  missingReasons: Partial<
    Record<OptionalPerformanceMetric | "throughputTokensPerSecond", string>
  >;
}

export interface NumericAggregate {
  availableSampleCount: number;
  missingSampleCount: number;
  sum: number | null;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  variance: number | null;
  missingReasons: string[];
}

export interface PerformanceReport {
  sampleCounts: {
    warmup: number;
    measured: number;
  };
  samples: PerformanceSample[];
  aggregates: {
    durationMs: NumericAggregate;
    providerDurationMs: NumericAggregate;
    ttftMs: NumericAggregate;
    inputTokens: NumericAggregate;
    outputTokens: NumericAggregate;
    costUsd: NumericAggregate;
    throughputTokensPerSecond: NumericAggregate;
  };
}

export interface CollectPerformanceSamplesOptions {
  sample(context: PerformanceSampleContext): Promise<PerformanceSampleInput>;
  warmupSamples?: number;
  measuredSamples?: number;
}

const DEFAULT_MISSING_REASON = "not_reported";

/**
 * Collects raw warmup and measured samples. Aggregates are calculated only
 * from measured samples, using population variance and linearly interpolated
 * percentiles.
 */
export async function collectPerformanceSamples(
  options: CollectPerformanceSamplesOptions,
): Promise<PerformanceReport> {
  const warmupSamples = options.warmupSamples ?? 1;
  const measuredSamples = options.measuredSamples ?? 5;
  validateSampleCount("warmupSamples", warmupSamples, true);
  validateSampleCount("measuredSamples", measuredSamples, false);
  const samples: PerformanceSample[] = [];

  for (let index = 0; index < warmupSamples; index += 1) {
    samples.push(
      normalizeSample(
        { phase: "warmup", index },
        await options.sample({ phase: "warmup", index }),
      ),
    );
  }
  for (let index = 0; index < measuredSamples; index += 1) {
    samples.push(
      normalizeSample(
        { phase: "measured", index },
        await options.sample({ phase: "measured", index }),
      ),
    );
  }

  const measured = samples.filter((sample) => sample.phase === "measured");
  return {
    sampleCounts: { warmup: warmupSamples, measured: measuredSamples },
    samples,
    aggregates: {
      durationMs: aggregate(measured, "durationMs"),
      providerDurationMs: aggregate(measured, "providerDurationMs"),
      ttftMs: aggregate(measured, "ttftMs"),
      inputTokens: aggregate(measured, "inputTokens"),
      outputTokens: aggregate(measured, "outputTokens"),
      costUsd: aggregate(measured, "costUsd"),
      throughputTokensPerSecond: aggregate(
        measured,
        "throughputTokensPerSecond",
      ),
    },
  };
}

function normalizeSample(
  context: PerformanceSampleContext,
  input: PerformanceSampleInput,
): PerformanceSample {
  const missingReasons: PerformanceSample["missingReasons"] = {};
  const providerDurationMs = optionalValue(
    input,
    "providerDurationMs",
    missingReasons,
  );
  const ttftMs = optionalValue(input, "ttftMs", missingReasons);
  const inputTokens = optionalValue(input, "inputTokens", missingReasons);
  const outputTokens = optionalValue(input, "outputTokens", missingReasons);
  const costUsd = optionalValue(input, "costUsd", missingReasons);
  const throughputTokensPerSecond =
    outputTokens === null || input.durationMs <= 0
      ? null
      : outputTokens / (input.durationMs / 1_000);
  if (throughputTokensPerSecond === null) {
    missingReasons.throughputTokensPerSecond =
      outputTokens === null
        ? required(
            missingReasons.outputTokens,
            "Missing output tokens must carry a reason.",
          )
        : "non_positive_duration";
  }

  return {
    ...context,
    durationMs: input.durationMs,
    providerDurationMs,
    ttftMs,
    inputTokens,
    outputTokens,
    costUsd,
    throughputTokensPerSecond,
    missingReasons,
  };
}

function validateSampleCount(
  name: "warmupSamples" | "measuredSamples",
  value: number,
  allowZero: boolean,
): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer.`);
  }
  if (!allowZero && value === 0) {
    throw new Error(`Invalid ${name}: expected a positive integer.`);
  }
}

function optionalValue(
  input: PerformanceSampleInput,
  metric: OptionalPerformanceMetric,
  missingReasons: PerformanceSample["missingReasons"],
): number | null {
  const value = input[metric];
  if (value === undefined || value === null) {
    missingReasons[metric] =
      input.missingReasons?.[metric] ?? DEFAULT_MISSING_REASON;
    return null;
  }
  return value;
}

type AggregateMetric = Exclude<
  keyof PerformanceSample,
  "phase" | "index" | "missingReasons"
>;

function aggregate(
  samples: PerformanceSample[],
  metric: AggregateMetric,
): NumericAggregate {
  const values = samples
    .map((sample) => sample[metric])
    .filter((value): value is number => value !== null);
  const sum =
    values.length === 0
      ? null
      : values.reduce((total, value) => total + value, 0);
  const mean = sum === null ? null : sum / values.length;
  const reasons = samples.flatMap((sample) => {
    if (sample[metric] !== null) {
      return [];
    }
    return [
      required(
        sample.missingReasons[
          metric as keyof PerformanceSample["missingReasons"]
        ],
        "Missing aggregate samples must carry a reason.",
      ),
    ];
  });

  return {
    availableSampleCount: values.length,
    missingSampleCount: samples.length - values.length,
    sum,
    mean,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    variance:
      mean === null
        ? null
        : values.reduce((total, value) => total + (value - mean) ** 2, 0) /
          values.length,
    missingReasons: [...new Set(reasons)],
  };
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = required(sorted[lowerIndex], "Percentile lower bound missing.");
  const upper = required(sorted[upperIndex], "Percentile upper bound missing.");
  return lower + (upper - lower) * (position - lowerIndex);
}

function required<T>(value: T | undefined, message: string): T {
  /* v8 ignore next -- callers establish the indexed-value invariants. */
  if (value === undefined) throw new Error(message);
  return value;
}
