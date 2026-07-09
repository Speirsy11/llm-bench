import type {
  Capability,
  MetricDirection,
  MetricKind,
} from "@llm-bench/contracts";

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
  requiredCapabilities: ["workspaces", "files"],
  primaryMetric: {
    id: "hidden_test_pass_ratio",
    label: "Hidden test pass ratio",
    kind: "ratio",
    unit: "ratio",
    direction: "higher_is_better",
  },
} as const satisfies BenchmarkDefinition;

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
