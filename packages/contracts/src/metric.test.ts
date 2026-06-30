import { describe, expect, it } from "vitest";

import {
  isBetterValue,
  MetricDefinitionSchema,
  selectBestObservation,
  selectPrimaryMetric,
} from "./metric";

describe("MetricDefinitionSchema", () => {
  it("accepts a duration metric that declares its unit and ranking direction", () => {
    const result = MetricDefinitionSchema.safeParse({
      id: "duration",
      label: "Wall-clock duration",
      kind: "duration",
      unit: "ms",
      direction: "lower_is_better",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a metric kind outside the supported set", () => {
    const result = MetricDefinitionSchema.safeParse({
      id: "vibes",
      label: "Vibes",
      kind: "vibes",
      unit: "score",
      direction: "higher_is_better",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown provider-specific fields", () => {
    const result = MetricDefinitionSchema.safeParse({
      id: "duration",
      label: "Wall-clock duration",
      kind: "duration",
      unit: "ms",
      direction: "lower_is_better",
      openaiOnly: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("isBetterValue", () => {
  it("treats larger values as better when higher_is_better", () => {
    expect(isBetterValue("higher_is_better", 0.9, 0.5)).toBe(true);
  });

  it("treats smaller values as better when lower_is_better", () => {
    expect(isBetterValue("lower_is_better", 120, 800)).toBe(true);
  });
});

describe("selectBestObservation", () => {
  it("returns null when no observation carries a value", () => {
    expect(
      selectBestObservation("higher_is_better", [
        { metricId: "pass_ratio", value: null },
      ]),
    ).toBeNull();
  });

  it("ignores missing data and keeps the best recorded value", () => {
    expect(
      selectBestObservation("lower_is_better", [
        { metricId: "duration", value: null },
        { metricId: "duration", value: 800 },
        { metricId: "duration", value: 120 },
        { metricId: "duration", value: 450 },
      ]),
    ).toEqual({ metricId: "duration", value: 120 });
  });
});

describe("selectPrimaryMetric", () => {
  const metrics = [
    {
      id: "pass_ratio",
      label: "Hidden-test pass ratio",
      kind: "ratio" as const,
      unit: "fraction",
      direction: "higher_is_better" as const,
    },
  ];

  it("returns the definition nominated as primary", () => {
    expect(selectPrimaryMetric(metrics, "pass_ratio")).toEqual(metrics[0]);
  });

  it("throws when the primary metric is not defined", () => {
    expect(() => selectPrimaryMetric(metrics, "cost")).toThrow(
      /Primary metric "cost" is not defined/,
    );
  });
});
