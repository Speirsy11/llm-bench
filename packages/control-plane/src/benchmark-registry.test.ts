import { describe, expect, it } from "vitest";

import {
  metricDefinitionForId,
  primaryMetricIdForBenchmark,
  repositoryRepairBenchmark,
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
});
