import type { Benchmark } from "./benchmark";
import type { Capability, CompatibilityResult } from "./capability";
import type { BenchmarkEvent, Checkpoint } from "./events";
import type { HarnessManifest, Limits, Toolset } from "./manifest";
import type { MetricObservation } from "./metric";
import { evaluateCompatibility } from "./capability";

/**
 * Abstract harness and provider contracts. Concrete process spawning and HTTP
 * calls are deliberately out of scope: these classes define the extension
 * surface (capability checks, resume rules, request/result shapes) that later
 * epics implement.
 */

export interface BenchmarkRunTarget {
  id: string;
  version: string;
}

export interface AdapterRunRequest {
  benchmark: BenchmarkRunTarget;
  modelRouteId: string;
  toolset: Toolset;
  limits: Limits;
}

export abstract class HarnessAdapter {
  constructor(readonly manifest: HarnessManifest) {}

  /** Whether the harness advertises a given capability. */
  advertises(capability: Capability): boolean {
    return this.manifest.capabilities.includes(capability);
  }

  /** Whether the harness can run a benchmark given its required capabilities. */
  accepts(benchmark: Benchmark): CompatibilityResult {
    return evaluateCompatibility(
      benchmark.requiredCapabilities,
      this.manifest.capabilities,
    );
  }

  abstract run(request: AdapterRunRequest): AsyncIterable<BenchmarkEvent>;
}

export abstract class ProcessHarnessAdapter extends HarnessAdapter {
  /**
   * A process harness may resume only when it advertises `session_resume` and a
   * resumable checkpoint exists; otherwise the job is treated as interrupted.
   */
  canResume(checkpoint: Checkpoint | null): boolean {
    return this.advertises("session_resume") && checkpoint?.resumable === true;
  }

  abstract command(request: AdapterRunRequest): string[];
}

export interface CompletionRequest {
  modelRouteId: string;
  prompt: string;
}

export interface CompletionResult {
  text: string;
  observations: MetricObservation[];
}

export abstract class OpenAICompatibleModelProvider {
  constructor(readonly manifest: HarnessManifest) {}

  /** Whether a model route id is configured on the provider manifest. */
  hasRoute(routeId: string): boolean {
    return this.manifest.modelRoutes.some((route) => route.id === routeId);
  }

  abstract complete(request: CompletionRequest): Promise<CompletionResult>;
}
