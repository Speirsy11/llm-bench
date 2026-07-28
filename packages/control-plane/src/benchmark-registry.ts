import type {
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
  readonly requiredCapabilities: readonly Capability[];
  readonly primaryMetric: MetricDefinition & {
    readonly label: string;
  };
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
  requiredCapabilities: [...REPOSITORY_REPAIR_REQUIRED_CAPABILITIES],
  primaryMetric: {
    id: "hidden_test_pass_ratio",
    label: "Hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
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

export const repositoryRepairLimits = {
  maxDurationMs: 30_000,
  maxToolCalls: 10,
  maxTokens: 10_000,
  maxTurns: 10,
} as const satisfies Limits;

const benchmarkRegistry = [repositoryRepairBenchmark];
const metricsById = new Map<string, MetricDefinition>(
  benchmarkRegistry.map((benchmark) => [
    benchmark.primaryMetric.id,
    benchmark.primaryMetric,
  ]),
);

export function primaryMetricIdForBenchmark(
  benchmarkId: string,
): string | null {
  return (
    benchmarkRegistry.find((benchmark) => benchmark.id === benchmarkId)
      ?.primaryMetric.id ?? null
  );
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
