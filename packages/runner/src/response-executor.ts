import type {
  AdapterRunResult,
  MetricObservation,
  ResponseBenchmark,
  ResponseCase,
} from "@llm-bench/contracts";
import type {
  PerformanceReport,
  PerformanceSampleContext,
} from "@llm-bench/performance";
import { collectPerformanceSamples } from "@llm-bench/performance";

export interface ResponseExecutionEvidence extends PerformanceReport {
  grades: {
    sampleIndex: number;
    observations: MetricObservation[];
  }[];
  invocations: {
    phase: PerformanceSampleContext["phase"];
    index: number;
    metadata: Record<string, unknown>;
  }[];
}

export interface ExecuteResponseBenchmarkOptions {
  benchmark: ResponseBenchmark;
  responseCase: ResponseCase;
  run(context: PerformanceSampleContext): Promise<AdapterRunResult>;
  now?: () => number;
}

export interface ResponseExecutionResult {
  observations: MetricObservation[];
  evidence: ResponseExecutionEvidence;
}

const aggregateMetricIds = {
  durationMs: "duration_ms",
  providerDurationMs: "provider_duration_ms",
  ttftMs: "ttft_ms",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  costUsd: "cost_usd",
  throughputTokensPerSecond: "throughput_tokens_per_second",
} as const;

/** Executes and grades a deterministic response case with typed evidence. */
export async function executeResponseBenchmark(
  options: ExecuteResponseBenchmarkOptions,
): Promise<ResponseExecutionResult> {
  const now = options.now ?? Date.now;
  const grades: ResponseExecutionEvidence["grades"] = [];
  const invocations: ResponseExecutionEvidence["invocations"] = [];
  const evidence = await collectPerformanceSamples({
    warmupSamples: options.benchmark.id === "performance" ? 1 : 0,
    measuredSamples: options.responseCase.repetitions,
    sample: async (context) => {
      const startedAt = now();
      const result = await options.run(context);
      const durationMs = now() - startedAt;
      if (result.status !== "completed") {
        throw new Error(
          result.error ??
            `Response harness stopped with status ${result.status}.`,
        );
      }
      invocations.push({
        ...context,
        metadata: structuredClone(result.metadata),
      });
      if (context.phase === "measured") {
        grades.push({
          sampleIndex: context.index,
          observations: options.benchmark.grade(
            options.responseCase.id,
            result.output,
          ),
        });
      }
      return {
        durationMs,
        providerDurationMs: observationValue(result, "provider_duration_ms"),
        ttftMs: observationValue(result, "ttft_ms"),
        inputTokens: observationValue(result, "input_tokens"),
        outputTokens: observationValue(result, "output_tokens"),
        costUsd: observationValue(result, "cost_usd"),
        missingReasons: {
          providerDurationMs: "harness_did_not_report_provider_duration",
          ttftMs: "harness_did_not_report_ttft",
          inputTokens: "harness_did_not_report_input_tokens",
          outputTokens: "harness_did_not_report_output_tokens",
          costUsd: "harness_did_not_report_cost",
        },
      };
    },
  });

  return {
    observations: [
      ...gradeAggregates(grades),
      ...Object.entries(aggregateMetricIds).map(([aggregateKey, metricId]) => ({
        metricId,
        value:
          evidence.aggregates[
            aggregateKey as keyof PerformanceReport["aggregates"]
          ].mean,
      })),
    ],
    evidence: { ...evidence, grades, invocations },
  };
}

function observationValue(
  result: AdapterRunResult,
  metricId: string,
): number | null {
  return (
    result.observations.find((observation) => observation.metricId === metricId)
      ?.value ?? null
  );
}

function gradeAggregates(
  grades: ResponseExecutionEvidence["grades"],
): MetricObservation[] {
  const metricIds = new Set(
    grades.flatMap((grade) =>
      grade.observations.map((observation) => observation.metricId),
    ),
  );
  return [...metricIds].map((metricId) => {
    const values = grades
      .flatMap((grade) => grade.observations)
      .filter((observation) => observation.metricId === metricId)
      .map((observation) => observation.value)
      .filter((value): value is number => value !== null);
    return {
      metricId,
      value:
        values.length === 0
          ? null
          : values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  });
}
