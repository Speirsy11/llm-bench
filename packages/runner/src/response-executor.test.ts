import { describe, expect, it, vi } from "vitest";

import type {
  AdapterRunResult,
  MetricObservation,
  ResponseCase,
} from "@llm-bench/contracts";
import { ResponseBenchmark } from "@llm-bench/contracts";
import { PerformanceBenchmark } from "@llm-bench/performance";
import { StructuredOutputBenchmark } from "@llm-bench/structured-output";

import { executeResponseBenchmark } from "./response-executor";

function completed(
  output: string,
  inputTokens: number,
  outputTokens: number,
  metadata: Record<string, unknown> = {},
  providerDurationMs?: number,
): AdapterRunResult {
  return {
    status: "completed",
    output,
    observations: [
      { metricId: "input_tokens", value: inputTokens },
      { metricId: "output_tokens", value: outputTokens },
      ...(providerDurationMs === undefined
        ? []
        : [{ metricId: "provider_duration_ms", value: providerDurationMs }]),
    ],
    checkpoint: null,
    events: [],
    metadata,
  };
}

describe("executeResponseBenchmark", () => {
  it("runs the declared response repetitions and preserves raw grades behind aggregates", async () => {
    const benchmark = new StructuredOutputBenchmark();
    const responseCase = firstCase(benchmark);
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        completed(
          '{"name":"Ada Lovelace","age":36,"active":true}',
          10,
          5,
          { model: "model-a", requestId: "request-1" },
          80,
        ),
      )
      .mockResolvedValueOnce(
        completed("not json", 20, 10, { model: "model-a" }, 150),
      )
      .mockResolvedValueOnce(
        completed(
          '{"name":"Ada Lovelace","age":36,"active":true}',
          30,
          15,
          { model: "model-a" },
          250,
        ),
      );
    const times = [0, 100, 100, 300, 300, 600];

    const result = await executeResponseBenchmark({
      benchmark,
      responseCase,
      run,
      now: () => {
        const time = times.shift();
        if (time === undefined) throw new Error("Expected a fixture time.");
        return time;
      },
    });

    expect(run).toHaveBeenCalledTimes(3);
    expect(result.observations).toEqual(
      expect.arrayContaining([
        { metricId: "schema_compliance", value: 2 / 3 },
        { metricId: "duration_ms", value: 200 },
        { metricId: "provider_duration_ms", value: 160 },
        { metricId: "input_tokens", value: 20 },
        { metricId: "output_tokens", value: 10 },
        { metricId: "ttft_ms", value: null },
        { metricId: "cost_usd", value: null },
      ]),
    );
    expect(result.evidence.samples).toHaveLength(3);
    expect(result.evidence.invocations).toEqual([
      {
        phase: "measured",
        index: 0,
        metadata: { model: "model-a", requestId: "request-1" },
      },
      {
        phase: "measured",
        index: 1,
        metadata: { model: "model-a" },
      },
      {
        phase: "measured",
        index: 2,
        metadata: { model: "model-a" },
      },
    ]);
    expect(result.evidence.grades).toEqual([
      {
        sampleIndex: 0,
        observations: [{ metricId: "schema_compliance", value: 1 }],
      },
      {
        sampleIndex: 1,
        observations: [{ metricId: "schema_compliance", value: 0 }],
      },
      {
        sampleIndex: 2,
        observations: [{ metricId: "schema_compliance", value: 1 }],
      },
    ]);
    expect(result.evidence.aggregates.ttftMs.missingReasons).toEqual([
      "harness_did_not_report_ttft",
    ]);
  });

  it("uses one warmup and five measured samples for the performance benchmark", async () => {
    const benchmark = new PerformanceBenchmark();
    const run = vi.fn().mockResolvedValue(completed("READY", 10, 5));
    let time = 0;

    const result = await executeResponseBenchmark({
      benchmark,
      responseCase: firstCase(benchmark),
      run,
      now: () => {
        time += 100;
        return time;
      },
    });

    expect(run).toHaveBeenCalledTimes(6);
    expect(result.evidence.sampleCounts).toEqual({
      warmup: 1,
      measured: 5,
    });
    expect(result.evidence.samples[0]?.phase).toBe("warmup");
    expect(result.evidence.invocations).toHaveLength(6);
    expect(result.evidence.invocations[0]).toMatchObject({
      phase: "warmup",
      index: 0,
    });
    expect(result.observations).toContainEqual({
      metricId: "exact_response",
      value: 1,
    });
  });

  it("fails a response run without aggregating a partial result", async () => {
    const benchmark = new StructuredOutputBenchmark();

    await expect(
      executeResponseBenchmark({
        benchmark,
        responseCase: firstCase(benchmark),
        run: () =>
          Promise.resolve({
            ...completed("", 0, 0),
            status: "failed",
            error: "provider failed",
          }),
      }),
    ).rejects.toThrow("provider failed");
  });

  it("describes a stopped harness that did not provide an error", async () => {
    const benchmark = new StructuredOutputBenchmark();

    await expect(
      executeResponseBenchmark({
        benchmark,
        responseCase: firstCase(benchmark),
        run: () =>
          Promise.resolve({
            ...completed("", 0, 0),
            status: "cancelled",
          }),
      }),
    ).rejects.toThrow("Response harness stopped with status cancelled.");
  });

  it("keeps an entirely missing grade aggregate null", async () => {
    const benchmark = new NullGradeBenchmark();

    const result = await executeResponseBenchmark({
      benchmark,
      responseCase: firstCase(benchmark),
      run: () => Promise.resolve(completed("unknown", 1, 1)),
    });

    expect(result.observations).toContainEqual({
      metricId: "missing_grade",
      value: null,
    });
  });
});

function firstCase(benchmark: ResponseBenchmark): ResponseCase {
  const responseCase = benchmark.cases()[0];
  if (responseCase === undefined) {
    throw new Error("Expected a response case fixture.");
  }
  return responseCase;
}

class NullGradeBenchmark extends ResponseBenchmark {
  constructor() {
    super({
      id: "null-grade",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: "missing_grade",
      metrics: [
        {
          id: "missing_grade",
          label: "Missing grade",
          kind: "ratio",
          unit: "ratio",
          direction: "higher_is_better",
        },
      ],
      requiredCapabilities: ["response_generation"],
    });
  }

  override cases(): ResponseCase[] {
    return [
      {
        id: "missing",
        prompt: "Return an unavailable grade.",
        repetitions: 1,
      },
    ];
  }

  override grade(): MetricObservation[] {
    return [{ metricId: "missing_grade", value: null }];
  }
}
