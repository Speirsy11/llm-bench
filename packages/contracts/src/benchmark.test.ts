import { describe, expect, it } from "vitest";

import type { BenchmarkManifest } from "./manifest";
import type { AgenticTask, ResponseCase } from "./workload";
import { AgenticBenchmark, ResponseBenchmark } from "./benchmark";

const passRatio = {
  id: "pass_ratio",
  label: "Hidden-test pass ratio",
  kind: "ratio" as const,
  unit: "fraction",
  direction: "higher_is_better" as const,
};

class JsonBenchmark extends ResponseBenchmark {
  override cases(): ResponseCase[] {
    return [{ id: "json-extract", prompt: "Return JSON.", repetitions: 3 }];
  }
}

class RepairBenchmark extends AgenticBenchmark {
  override tasks(): AgenticTask[] {
    return [
      {
        id: "ts-null-guard",
        language: "typescript",
        constraints: [],
        repetitions: 1,
      },
    ];
  }
}

const responseManifest: BenchmarkManifest = {
  id: "structured-output",
  version: "1.0.0",
  kind: "response",
  primaryMetricId: "pass_ratio",
  metrics: [passRatio],
  requiredCapabilities: ["response_generation", "structured_output"],
};

const agenticManifest: BenchmarkManifest = {
  id: "repo-repair",
  version: "1.0.0",
  kind: "agentic",
  primaryMetricId: "pass_ratio",
  metrics: [passRatio],
  requiredCapabilities: ["workspaces", "shell", "files"],
};

describe("ResponseBenchmark", () => {
  const benchmark = new JsonBenchmark(responseManifest);

  it("exposes manifest identity and required capabilities", () => {
    expect(benchmark.id).toBe("structured-output");
    expect(benchmark.requiredCapabilities).toEqual([
      "response_generation",
      "structured_output",
    ]);
  });

  it("defaults response repetitions to three", () => {
    expect(benchmark.defaultRepetitions()).toBe(3);
  });

  it("resolves the nominated primary metric definition", () => {
    expect(benchmark.primaryMetric()).toEqual(passRatio);
  });

  it("is compatible with a harness advertising every required capability", () => {
    expect(
      benchmark.isCompatibleWith({
        id: "llm-bench",
        version: "1.0.0",
        capabilities: ["response_generation", "structured_output", "streaming"],
        modelRoutes: [],
      }),
    ).toEqual({ compatible: true });
  });

  it("reports missing capabilities against a constrained harness", () => {
    expect(
      benchmark.isCompatibleWith({
        id: "weak",
        version: "1.0.0",
        capabilities: ["response_generation"],
        modelRoutes: [],
      }),
    ).toEqual({ compatible: false, missing: ["structured_output"] });
  });
});

describe("AgenticBenchmark", () => {
  const benchmark = new RepairBenchmark(agenticManifest);

  it("defaults agentic repetitions to one", () => {
    expect(benchmark.defaultRepetitions()).toBe(1);
  });

  it("exposes its tasks through the public interface", () => {
    expect(benchmark.tasks()).toHaveLength(1);
  });
});
