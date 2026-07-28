import type {
  BenchmarkKind,
  Capability,
  Limits,
  MetricDirection,
  MetricKind,
  RunnerExecution,
} from "@llm-bench/contracts";
import { REPOSITORY_REPAIR_REQUIRED_CAPABILITIES } from "@llm-bench/contracts";

export interface BenchmarkDefinition {
  readonly id: string;
  readonly version: string;
  readonly kind: BenchmarkKind;
  readonly targetKind: "response" | "workspace";
  readonly requiredCapabilities: readonly Capability[];
  readonly primaryMetric: MetricDefinition & {
    readonly label: string;
  };
  readonly metrics: readonly (MetricDefinition & {
    readonly label: string;
  })[];
}

export interface MetricDefinition {
  readonly id: string;
  readonly kind: MetricKind;
  readonly unit: string;
  readonly direction: MetricDirection;
}

export const repositoryRepairBenchmark = {
  id: "repository-repair",
  version: "1.0.0",
  kind: "agentic",
  targetKind: "workspace",
  requiredCapabilities: [...REPOSITORY_REPAIR_REQUIRED_CAPABILITIES],
  primaryMetric: {
    id: "hidden_test_pass_ratio",
    label: "Hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
  metrics: [
    {
      id: "hidden_test_pass_ratio",
      label: "Hidden test pass ratio",
      kind: "ratio",
      unit: "ratio",
      direction: "higher_is_better",
    },
  ],
} as const satisfies BenchmarkDefinition;

export const structuredOutputBenchmark = responseBenchmark({
  id: "structured-output",
  primaryMetric: {
    id: "schema_compliance",
    label: "Schema compliance",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
});

export const instructionFollowingBenchmark = responseBenchmark({
  id: "instruction-following",
  primaryMetric: {
    id: "instruction_compliance",
    label: "Instruction compliance",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
});

const performanceMetrics = [
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
] as const;

export const performanceBenchmark = {
  id: "performance",
  version: "1.0.0",
  kind: "response",
  targetKind: "response",
  requiredCapabilities: ["response_generation"],
  primaryMetric: performanceMetrics[0],
  metrics: performanceMetrics,
} as const satisfies BenchmarkDefinition;

/**
 * The original repository-repair tracer task. The control plane owns this
 * public catalog snapshot; hidden grader code remains runner-local.
 */
export const repositoryRepairWorkload = {
  kind: "agentic",
  task: {
    id: "typescript-clamp-bounds",
    language: "typescript",
    constraints: [
      "Do not modify the hidden tests.",
      "Keep the clamp signature.",
      "Runtime requirement: node >=22.",
      "Offline execution only; do not use the network.",
    ],
    repetitions: 1,
  },
  fixtureContentHash:
    "8e42d532e59944b84da613b1043664543196d9ce5adfa838e51477fe3689d9d8",
  graderHash:
    "d1afab274bbefb8730adace300b9714b23d2e52df12dc1221927f01970b0089a",
} as const satisfies RunnerExecution["workload"];

export const structuredOutputWorkload = {
  kind: "response",
  case: {
    id: "customer-record",
    prompt:
      "Return only a JSON object for customer Ada Lovelace, age 36, with active status true.",
    repetitions: 3,
  },
} as const satisfies RunnerExecution["workload"];

export const instructionFollowingWorkload = {
  kind: "response",
  case: {
    id: "three-short-bullets",
    prompt:
      "Describe reproducible benchmarking in exactly three bullet lines. Start each line with '- ' and use no more than eight words per line.",
    repetitions: 3,
  },
} as const satisfies RunnerExecution["workload"];

export const performanceWorkload = {
  kind: "response",
  case: {
    id: "sentinel-response",
    prompt: "Reply with exactly the word READY and nothing else.",
    repetitions: 5,
  },
} as const satisfies RunnerExecution["workload"];

export const repositoryRepairLimits = {
  maxDurationMs: 30_000,
  maxToolCalls: 10,
  maxTokens: 10_000,
  maxTurns: 10,
} as const satisfies Limits;

export const responseLimits = {
  maxDurationMs: 30_000,
  maxToolCalls: 0,
  maxTokens: 2_000,
  maxTurns: 1,
} as const satisfies Limits;

export const benchmarkCatalog = [
  repositoryRepairBenchmark,
  structuredOutputBenchmark,
  instructionFollowingBenchmark,
  performanceBenchmark,
] as const satisfies readonly BenchmarkDefinition[];

const workloadsByBenchmarkId: Readonly<
  Record<string, RunnerExecution["workload"]>
> = {
  "repository-repair": repositoryRepairWorkload,
  "structured-output": structuredOutputWorkload,
  "instruction-following": instructionFollowingWorkload,
  performance: performanceWorkload,
};

const metricsById = new Map<string, MetricDefinition>(
  benchmarkCatalog.flatMap((benchmark) =>
    benchmark.metrics.map((metric) => {
      const { label: _label, ...definition } = metric;
      return [metric.id, definition] as const;
    }),
  ),
);

export function primaryMetricIdForBenchmark(
  benchmarkId: string,
): string | null {
  return (
    benchmarkCatalog.find((benchmark) => benchmark.id === benchmarkId)
      ?.primaryMetric.id ?? null
  );
}

export function benchmarkDefinitionForId(
  benchmarkId: string,
): BenchmarkDefinition | null {
  return (
    benchmarkCatalog.find((benchmark) => benchmark.id === benchmarkId) ?? null
  );
}

export function workloadForBenchmark(
  benchmarkId: string,
): RunnerExecution["workload"] | null {
  return workloadsByBenchmarkId[benchmarkId] ?? null;
}

export function limitsForBenchmark(benchmarkId: string): Limits | null {
  const benchmark = benchmarkDefinitionForId(benchmarkId);
  if (benchmark === null) return null;
  return benchmark.kind === "agentic" ? repositoryRepairLimits : responseLimits;
}

function responseBenchmark(input: {
  id: string;
  primaryMetric: BenchmarkDefinition["primaryMetric"];
}): BenchmarkDefinition {
  return {
    id: input.id,
    version: "1.0.0",
    kind: "response",
    targetKind: "response",
    requiredCapabilities: ["response_generation"],
    primaryMetric: input.primaryMetric,
    metrics: [input.primaryMetric],
  };
}

export function metricDefinitionForId(metricId: string): MetricDefinition {
  return (
    metricsById.get(metricId) ?? {
      id: metricId,
      kind: "count",
      unit: "count",
      direction: "higher_is_better",
    }
  );
}
