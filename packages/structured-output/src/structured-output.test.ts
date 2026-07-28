import { describe, expect, it } from "vitest";

import type { ResponseBenchmark } from "@llm-bench/contracts";

import { StructuredOutputBenchmark } from "./structured-output";

describe("StructuredOutputBenchmark", () => {
  it("grades a known structured response through the response benchmark contract", () => {
    const benchmark: ResponseBenchmark = new StructuredOutputBenchmark();
    const [responseCase] = benchmark.cases();

    expect(responseCase).toEqual({
      id: "customer-record",
      prompt:
        "Return only a JSON object for customer Ada Lovelace, age 36, with active status true.",
      repetitions: 3,
    });
    expect(
      benchmark.grade(
        "customer-record",
        '{"name":"Ada Lovelace","age":36,"active":true}',
      ),
    ).toEqual([{ metricId: "schema_compliance", value: 1 }]);
  });

  it.each([
    ["invalid JSON", "not json"],
    ["wrong field values", '{"name":"Grace Hopper","age":36,"active":true}'],
    ["wrong field types", '{"name":"Ada Lovelace","age":"36","active":true}'],
    [
      "additional fields",
      '{"name":"Ada Lovelace","age":36,"active":true,"role":"analyst"}',
    ],
  ])("scores %s as non-compliant", (_description, response) => {
    const benchmark = new StructuredOutputBenchmark();

    expect(benchmark.grade("customer-record", response)).toEqual([
      { metricId: "schema_compliance", value: 0 },
    ]);
  });

  it("rejects an unknown case", () => {
    const benchmark = new StructuredOutputBenchmark();

    expect(() => benchmark.grade("unknown", "{}")).toThrow(
      "Unknown structured-output case: unknown",
    );
  });
});
