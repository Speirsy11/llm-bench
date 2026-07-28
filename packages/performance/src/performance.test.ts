import { describe, expect, it, vi } from "vitest";

import type { PerformanceSampleContext } from "./performance";
import {
  collectPerformanceSamples,
  PerformanceBenchmark,
  performanceMetricDefinitions,
} from "./performance";

describe("PerformanceBenchmark", () => {
  it("publishes a controlled response case and independently checks its sentinel output", () => {
    const benchmark = new PerformanceBenchmark();

    expect(benchmark.manifest).toMatchObject({
      id: "performance",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: "duration_ms",
      requiredCapabilities: ["response_generation"],
      metrics: performanceMetricDefinitions,
    });
    expect(benchmark.cases()).toEqual([
      {
        id: "sentinel-response",
        prompt: "Reply with exactly the word READY and nothing else.",
        repetitions: 5,
      },
    ]);
    expect(benchmark.grade("sentinel-response", "READY")).toEqual([
      { metricId: "exact_response", value: 1 },
    ]);
    expect(benchmark.grade("sentinel-response", "Ready.")).toEqual([
      { metricId: "exact_response", value: 0 },
    ]);
    expect(() => benchmark.grade("unknown", "READY")).toThrow(
      "Unknown performance case: unknown",
    );
  });
});

describe("collectPerformanceSamples", () => {
  it("excludes one warmup from five measured samples and matches literal aggregates", async () => {
    const observations = [
      {
        durationMs: 10_000,
        providerDurationMs: 8_000,
        ttftMs: 9_000,
        inputTokens: 1_000,
        outputTokens: 1_000,
        costUsd: 10,
      },
      {
        durationMs: 100,
        providerDurationMs: 80,
        ttftMs: 10,
        inputTokens: 5,
        outputTokens: 10,
        costUsd: 0.01,
      },
      {
        durationMs: 200,
        providerDurationMs: 160,
        ttftMs: 20,
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.02,
      },
      {
        durationMs: 300,
        providerDurationMs: null,
        ttftMs: null,
        inputTokens: 15,
        outputTokens: 30,
        costUsd: null,
        missingReasons: {
          providerDurationMs: "harness_did_not_report_provider_duration",
          ttftMs: "provider_did_not_report_ttft",
          costUsd: "route_has_no_price",
        },
      },
      {
        durationMs: 400,
        providerDurationMs: 320,
        ttftMs: 40,
        inputTokens: 20,
        outputTokens: null,
        costUsd: 0.04,
        missingReasons: {
          outputTokens: "provider_did_not_report_usage",
        },
      },
      {
        durationMs: 500,
        providerDurationMs: 400,
        ttftMs: 50,
        inputTokens: 25,
        outputTokens: 50,
        costUsd: 0.05,
      },
    ];
    const sample = vi.fn((_context: PerformanceSampleContext) => {
      const observation = observations.shift();
      if (observation === undefined) {
        return Promise.reject(new Error("Unexpected sample"));
      }
      return Promise.resolve(observation);
    });

    const report = await collectPerformanceSamples({ sample });

    expect(sample).toHaveBeenCalledTimes(6);
    expect(sample.mock.calls.map(([context]) => context)).toEqual([
      { phase: "warmup", index: 0 },
      { phase: "measured", index: 0 },
      { phase: "measured", index: 1 },
      { phase: "measured", index: 2 },
      { phase: "measured", index: 3 },
      { phase: "measured", index: 4 },
    ]);
    expect(report.sampleCounts).toEqual({ warmup: 1, measured: 5 });
    expect(report.samples).toHaveLength(6);
    expect(report.samples[0]).toMatchObject({
      phase: "warmup",
      durationMs: 10_000,
    });
    expect(report.aggregates.durationMs).toEqual({
      availableSampleCount: 5,
      missingSampleCount: 0,
      sum: 1_500,
      mean: 300,
      p50: 300,
      p95: 480,
      variance: 20_000,
      missingReasons: [],
    });
    expect(report.aggregates.providerDurationMs).toEqual({
      availableSampleCount: 4,
      missingSampleCount: 1,
      sum: 960,
      mean: 240,
      p50: 240,
      p95: 388,
      variance: 16_000,
      missingReasons: ["harness_did_not_report_provider_duration"],
    });
    expect(report.aggregates.ttftMs).toEqual({
      availableSampleCount: 4,
      missingSampleCount: 1,
      sum: 120,
      mean: 30,
      p50: 30,
      p95: 48.5,
      variance: 250,
      missingReasons: ["provider_did_not_report_ttft"],
    });
    expect(report.aggregates.inputTokens.sum).toBe(75);
    expect(report.aggregates.outputTokens.sum).toBe(110);
    expect(report.aggregates.costUsd.sum).toBeCloseTo(0.12);
    expect(report.aggregates.throughputTokensPerSecond).toEqual({
      availableSampleCount: 4,
      missingSampleCount: 1,
      sum: 400,
      mean: 100,
      p50: 100,
      p95: 100,
      variance: 0,
      missingReasons: ["provider_did_not_report_usage"],
    });
  });

  it("keeps unavailable metadata null with explicit default reasons", async () => {
    const report = await collectPerformanceSamples({
      warmupSamples: 0,
      measuredSamples: 1,
      sample: () => Promise.resolve({ durationMs: 250 }),
    });

    expect(report.sampleCounts).toEqual({ warmup: 0, measured: 1 });
    expect(report.samples).toEqual([
      {
        phase: "measured",
        index: 0,
        durationMs: 250,
        providerDurationMs: null,
        ttftMs: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        throughputTokensPerSecond: null,
        missingReasons: {
          providerDurationMs: "not_reported",
          ttftMs: "not_reported",
          inputTokens: "not_reported",
          outputTokens: "not_reported",
          costUsd: "not_reported",
          throughputTokensPerSecond: "not_reported",
        },
      },
    ]);
    expect(report.aggregates.ttftMs).toEqual({
      availableSampleCount: 0,
      missingSampleCount: 1,
      sum: null,
      mean: null,
      p50: null,
      p95: null,
      variance: null,
      missingReasons: ["not_reported"],
    });
    expect(report.aggregates.providerDurationMs.missingReasons).toEqual([
      "not_reported",
    ]);
  });

  it("does not invent infinite throughput for a non-positive duration", async () => {
    const report = await collectPerformanceSamples({
      warmupSamples: 0,
      measuredSamples: 1,
      sample: () =>
        Promise.resolve({
          durationMs: 0,
          outputTokens: 5,
        }),
    });

    expect(report.samples[0]).toMatchObject({
      throughputTokensPerSecond: null,
      missingReasons: {
        throughputTokensPerSecond: "non_positive_duration",
      },
    });
    expect(report.aggregates.throughputTokensPerSecond).toMatchObject({
      availableSampleCount: 0,
      missingSampleCount: 1,
      mean: null,
      missingReasons: ["non_positive_duration"],
    });
  });

  it.each([
    ["warmupSamples", -1],
    ["warmupSamples", 0.5],
    ["warmupSamples", Number.NaN],
    ["measuredSamples", 0],
    ["measuredSamples", -1],
    ["measuredSamples", 1.5],
    ["measuredSamples", Number.NaN],
  ] as const)("rejects an invalid %s value of %s", async (key, value) => {
    const sample = vi.fn(() => Promise.resolve({ durationMs: 1 }));

    await expect(
      collectPerformanceSamples({
        sample,
        [key]: value,
      }),
    ).rejects.toThrow(`Invalid ${key}`);
    expect(sample).not.toHaveBeenCalled();
  });
});
