import { z } from "zod";

import type { MetricObservation, ResponseCase } from "@llm-bench/contracts";
import { ResponseBenchmark } from "@llm-bench/contracts";

const customerRecord = z.strictObject({
  name: z.literal("Ada Lovelace"),
  age: z.literal(36),
  active: z.literal(true),
});

const cases: ResponseCase[] = [
  {
    id: "customer-record",
    prompt:
      "Return only a JSON object for customer Ada Lovelace, age 36, with active status true.",
    repetitions: 3,
  },
];

export class StructuredOutputBenchmark extends ResponseBenchmark {
  constructor() {
    super({
      id: "structured-output",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: "schema_compliance",
      metrics: [
        {
          id: "schema_compliance",
          label: "Schema compliance",
          kind: "ratio",
          unit: "ratio",
          direction: "higher_is_better",
        },
      ],
      requiredCapabilities: ["response_generation"],
    });
  }

  override cases(): ResponseCase[] {
    return structuredClone(cases);
  }

  override grade(caseId: string, response: string): MetricObservation[] {
    if (caseId !== "customer-record") {
      throw new Error(`Unknown structured-output case: ${caseId}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(response);
    } catch {
      return [{ metricId: "schema_compliance", value: 0 }];
    }
    return [
      {
        metricId: "schema_compliance",
        value: customerRecord.safeParse(value).success ? 1 : 0,
      },
    ];
  }
}
