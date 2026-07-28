import { describe, expect, it } from "vitest";

import {
  metricDefinitionForId,
  primaryMetricIdForBenchmark,
  repositoryRepairBenchmark,
  repositoryRepairWorkload,
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
});
