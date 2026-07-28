import { describe, expect, it } from "vitest";

import type { ResponseBenchmark } from "@llm-bench/contracts";

import { InstructionFollowingBenchmark } from "./instruction-following";

describe("InstructionFollowingBenchmark", () => {
  it("grades an exact short-bullet constraint through the response benchmark contract", () => {
    const benchmark: ResponseBenchmark = new InstructionFollowingBenchmark();
    const [responseCase] = benchmark.cases();

    expect(responseCase).toEqual({
      id: "three-short-bullets",
      prompt:
        "Describe reproducible benchmarking in exactly three bullet lines. Start each line with '- ' and use no more than eight words per line.",
      repetitions: 3,
    });
    expect(
      benchmark.grade(
        "three-short-bullets",
        "- Pin every version\n- Preserve every raw sample\n- Report missing data explicitly",
      ),
    ).toEqual([{ metricId: "instruction_compliance", value: 1 }]);
  });

  it.each([
    ["too few lines", "- Pin every version\n- Preserve every raw sample"],
    [
      "too many lines",
      "- Pin every version\n- Preserve every raw sample\n- Report missing data explicitly\n- Keep results comparable",
    ],
    [
      "a wrong prefix",
      "* Pin every version\n- Preserve every raw sample\n- Report missing data explicitly",
    ],
    [
      "more than eight words",
      "- Pin every single dependency version in every benchmark environment\n- Preserve every raw sample\n- Report missing data explicitly",
    ],
    [
      "an empty bullet",
      "- \n- Preserve every raw sample\n- Report missing data explicitly",
    ],
  ])("scores %s as non-compliant", (_description, response) => {
    const benchmark = new InstructionFollowingBenchmark();

    expect(benchmark.grade("three-short-bullets", response)).toEqual([
      { metricId: "instruction_compliance", value: 0 },
    ]);
  });

  it("accepts CRLF line endings", () => {
    const benchmark = new InstructionFollowingBenchmark();

    expect(
      benchmark.grade(
        "three-short-bullets",
        "- Pin every version\r\n- Preserve every raw sample\r\n- Report missing data explicitly",
      ),
    ).toEqual([{ metricId: "instruction_compliance", value: 1 }]);
  });

  it("rejects an unknown case", () => {
    const benchmark = new InstructionFollowingBenchmark();

    expect(() => benchmark.grade("unknown", "")).toThrow(
      "Unknown instruction-following case: unknown",
    );
  });
});
