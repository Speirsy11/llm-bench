import type { MetricObservation, ResponseCase } from "@llm-bench/contracts";
import { ResponseBenchmark } from "@llm-bench/contracts";

const CASE_ID = "three-short-bullets";
const METRIC_ID = "instruction_compliance";

const cases: ResponseCase[] = [
  {
    id: CASE_ID,
    prompt:
      "Describe reproducible benchmarking in exactly three bullet lines. Start each line with '- ' and use no more than eight words per line.",
    repetitions: 3,
  },
];

export class InstructionFollowingBenchmark extends ResponseBenchmark {
  constructor() {
    super({
      id: "instruction-following",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: METRIC_ID,
      metrics: [
        {
          id: METRIC_ID,
          label: "Instruction compliance",
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
    if (caseId !== CASE_ID) {
      throw new Error(`Unknown instruction-following case: ${caseId}`);
    }

    const lines = response.split(/\r?\n/u);
    const followsInstructions =
      lines.length === 3 &&
      lines.every((line) => {
        if (!line.startsWith("- ")) {
          return false;
        }
        const words = line.slice(2).trim().split(/\s+/u);
        return words.length > 0 && words.length <= 8 && words[0] !== "";
      });

    return [{ metricId: METRIC_ID, value: followsInstructions ? 1 : 0 }];
  }
}
