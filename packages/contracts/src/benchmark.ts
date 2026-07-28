import type { Capability, CompatibilityResult } from "./capability";
import type { BenchmarkManifest, HarnessManifest } from "./manifest";
import type { MetricDefinition, MetricObservation } from "./metric";
import type { AgenticTask, ResponseCase } from "./workload";
import { evaluateCompatibility } from "./capability";
import { selectPrimaryMetric } from "./metric";

/**
 * Abstract benchmark contracts. A `Benchmark` carries a manifest and answers
 * compatibility questions; `ResponseBenchmark` and `AgenticBenchmark` add the
 * workload and grading behavior each kind contributes.
 */

export abstract class Benchmark {
  constructor(readonly manifest: BenchmarkManifest) {}

  get id(): string {
    return this.manifest.id;
  }

  get requiredCapabilities(): Capability[] {
    return this.manifest.requiredCapabilities;
  }

  /** The metric definition this benchmark nominates as primary. */
  primaryMetric(): MetricDefinition {
    return selectPrimaryMetric(
      this.manifest.metrics,
      this.manifest.primaryMetricId,
    );
  }

  /** Whether a harness advertises every capability this benchmark requires. */
  isCompatibleWith(harness: HarnessManifest): CompatibilityResult {
    return evaluateCompatibility(
      this.manifest.requiredCapabilities,
      harness.capabilities,
    );
  }

  abstract defaultRepetitions(): number;
}

export abstract class ResponseBenchmark extends Benchmark {
  defaultRepetitions(): number {
    return 3;
  }

  abstract cases(): ResponseCase[];

  /** Deterministically grade one raw response without invoking another model. */
  abstract grade(caseId: string, response: string): MetricObservation[];
}

export abstract class AgenticBenchmark extends Benchmark {
  defaultRepetitions(): number {
    return 1;
  }

  abstract tasks(): AgenticTask[];
}
