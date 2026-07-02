import { describe, expect, it } from "vitest";

import type { Checkpoint } from "./events";
import type {
  AdapterRunRequest,
  AdapterRunResult,
  CompletionResult,
} from "./harness";
import type { BenchmarkManifest, HarnessManifest } from "./manifest";
import type { ResponseCase } from "./workload";
import { ResponseBenchmark } from "./benchmark";
import {
  HarnessAdapter,
  OpenAICompatibleModelProvider,
  ProcessHarnessAdapter,
} from "./harness";

const benchmarkManifest: BenchmarkManifest = {
  id: "structured-output",
  version: "1.0.0",
  kind: "response",
  primaryMetricId: "pass_ratio",
  metrics: [
    {
      id: "pass_ratio",
      label: "Pass ratio",
      kind: "ratio",
      unit: "fraction",
      direction: "higher_is_better",
    },
  ],
  requiredCapabilities: ["response_generation", "workspaces"],
};

class JsonBenchmark extends ResponseBenchmark {
  override cases(): ResponseCase[] {
    return [];
  }
}

class StubHarness extends HarnessAdapter {
  override run(_request: AdapterRunRequest): Promise<AdapterRunResult> {
    return Promise.resolve(emptyRunResult());
  }
}

class StubProcessHarness extends ProcessHarnessAdapter {
  override run(_request: AdapterRunRequest): Promise<AdapterRunResult> {
    return Promise.resolve(emptyRunResult());
  }

  override command(): string[] {
    return [];
  }
}

function emptyRunResult(): AdapterRunResult {
  return {
    status: "completed",
    output: "",
    observations: [],
    checkpoint: null,
    events: [],
    metadata: {},
  };
}

class StubProvider extends OpenAICompatibleModelProvider {
  override complete(): Promise<CompletionResult> {
    return Promise.resolve({ text: "", observations: [] });
  }
}

const harnessManifest = (
  capabilities: HarnessManifest["capabilities"],
): HarnessManifest => ({
  id: "stub",
  version: "1.0.0",
  capabilities,
  modelRoutes: [
    { id: "default", provider: "openrouter", model: "openai/gpt-4o" },
  ],
});

describe("HarnessAdapter", () => {
  it("reports whether a capability is advertised", () => {
    const adapter = new StubHarness(harnessManifest(["workspaces"]));

    expect(adapter.advertises("workspaces")).toBe(true);
    expect(adapter.advertises("shell")).toBe(false);
  });

  it("rejects a benchmark whose capabilities exceed what it advertises", () => {
    const adapter = new StubHarness(harnessManifest(["response_generation"]));

    expect(adapter.accepts(new JsonBenchmark(benchmarkManifest))).toEqual({
      compatible: false,
      missing: ["workspaces"],
    });
  });
});

describe("ProcessHarnessAdapter", () => {
  const resumableCheckpoint: Checkpoint = {
    jobId: "job-1",
    sequence: 2,
    resumable: true,
    state: {},
  };

  it("cannot resume when it does not advertise session_resume", () => {
    const adapter = new StubProcessHarness(harnessManifest(["workspaces"]));

    expect(adapter.canResume(resumableCheckpoint)).toBe(false);
  });

  it("cannot resume without a checkpoint", () => {
    const adapter = new StubProcessHarness(harnessManifest(["session_resume"]));

    expect(adapter.canResume(null)).toBe(false);
  });

  it("cannot resume from a non-resumable checkpoint", () => {
    const adapter = new StubProcessHarness(harnessManifest(["session_resume"]));

    expect(
      adapter.canResume({ ...resumableCheckpoint, resumable: false }),
    ).toBe(false);
  });

  it("resumes when it advertises session_resume and the checkpoint is resumable", () => {
    const adapter = new StubProcessHarness(harnessManifest(["session_resume"]));

    expect(adapter.canResume(resumableCheckpoint)).toBe(true);
  });
});

describe("OpenAICompatibleModelProvider", () => {
  it("reports whether a model route is configured", () => {
    const provider = new StubProvider(harnessManifest(["response_generation"]));

    expect(provider.hasRoute("default")).toBe(true);
    expect(provider.hasRoute("missing")).toBe(false);
  });
});
