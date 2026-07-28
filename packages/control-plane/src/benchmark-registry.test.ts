import { describe, expect, it } from "vitest";

import {
  benchmarkCatalog,
  benchmarkDefinitionForId,
  instructionFollowingBenchmark,
  instructionFollowingWorkload,
  limitsForBenchmark,
  metricDefinitionForId,
  performanceBenchmark,
  performanceWorkload,
  primaryMetricIdForBenchmark,
  repositoryRepairBenchmark,
  repositoryRepairWorkload,
  structuredOutputBenchmark,
  structuredOutputWorkload,
  workloadForBenchmark,
} from "./benchmark-registry";

describe("benchmark registry", () => {
  it("resolves the repository repair primary metric", () => {
    expect(primaryMetricIdForBenchmark(repositoryRepairBenchmark.id)).toBe(
      "hidden_test_pass_ratio",
    );
    expect(metricDefinitionForId("hidden_test_pass_ratio")).toMatchObject({
      id: "hidden_test_pass_ratio",
      kind: "ratio",
      unit: "ratio",
      direction: "higher_is_better",
    });
  });

  it("falls back to a count metric for unknown observations", () => {
    expect(primaryMetricIdForBenchmark("unknown-benchmark")).toBeNull();
    expect(metricDefinitionForId("custom_metric")).toEqual({
      id: "custom_metric",
      kind: "count",
      unit: "count",
      direction: "higher_is_better",
    });
  });

  it("pins the canonical repository-repair fixture and isolated grader hashes", () => {
    expect(repositoryRepairWorkload.fixtureContentHash).toBe(
      "8e42d532e59944b84da613b1043664543196d9ce5adfa838e51477fe3689d9d8",
    );
    expect(repositoryRepairWorkload.graderHash).toBe(
      "d1afab274bbefb8730adace300b9714b23d2e52df12dc1221927f01970b0089a",
    );
  });

  it("publishes response benchmarks with truthful kinds and repetition defaults", () => {
    expect(
      benchmarkCatalog.map(({ id, kind, targetKind }) => ({
        id,
        kind,
        targetKind,
      })),
    ).toEqual([
      {
        id: "repository-repair",
        kind: "agentic",
        targetKind: "workspace",
      },
      {
        id: "structured-output",
        kind: "response",
        targetKind: "response",
      },
      {
        id: "instruction-following",
        kind: "response",
        targetKind: "response",
      },
      {
        id: "performance",
        kind: "response",
        targetKind: "response",
      },
    ]);
    expect(structuredOutputWorkload.case.repetitions).toBe(3);
    expect(instructionFollowingWorkload.case.repetitions).toBe(3);
    expect(performanceWorkload.case.repetitions).toBe(5);
    expect(structuredOutputBenchmark.primaryMetric.id).toBe(
      "schema_compliance",
    );
    expect(instructionFollowingBenchmark.primaryMetric.id).toBe(
      "instruction_compliance",
    );
    expect(performanceBenchmark.primaryMetric.id).toBe("duration_ms");
  });

  it("resolves the stable performance metric vocabulary", () => {
    expect(metricDefinitionForId("duration_ms")).toEqual({
      id: "duration_ms",
      kind: "duration",
      unit: "ms",
      direction: "lower_is_better",
    });
    expect(metricDefinitionForId("provider_duration_ms")).toEqual({
      id: "provider_duration_ms",
      kind: "duration",
      unit: "ms",
      direction: "lower_is_better",
    });
    expect(metricDefinitionForId("throughput_tokens_per_second")).toEqual({
      id: "throughput_tokens_per_second",
      kind: "rate",
      unit: "tokens/s",
      direction: "higher_is_better",
    });
    expect(primaryMetricIdForBenchmark("performance")).toBe("duration_ms");
    expect(benchmarkDefinitionForId("performance")?.kind).toBe("response");
    expect(workloadForBenchmark("performance")).toEqual(performanceWorkload);
    expect(limitsForBenchmark("performance")).toMatchObject({
      maxToolCalls: 0,
      maxTurns: 1,
    });
    expect(benchmarkDefinitionForId("unknown")).toBeNull();
    expect(workloadForBenchmark("unknown")).toBeNull();
    expect(workloadForBenchmark("toString")).toBeNull();
    expect(workloadForBenchmark("constructor")).toBeNull();
    expect(limitsForBenchmark("unknown")).toBeNull();
  });
});
