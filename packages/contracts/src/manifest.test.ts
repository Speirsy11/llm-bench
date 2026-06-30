import { describe, expect, it } from "vitest";

import {
  BenchmarkManifestSchema,
  HarnessManifestSchema,
  LimitsSchema,
  ModelRouteSchema,
  ToolsetSchema,
} from "./manifest";

const passRatio = {
  id: "pass_ratio",
  label: "Hidden-test pass ratio",
  kind: "ratio" as const,
  unit: "fraction",
  direction: "higher_is_better" as const,
};

describe("BenchmarkManifestSchema", () => {
  it("validates a minimal response benchmark manifest", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "structured-output",
      version: "1.0.0",
      kind: "response",
      primaryMetricId: "pass_ratio",
      metrics: [passRatio],
      requiredCapabilities: ["response_generation", "structured_output"],
    });

    expect(result.success).toBe(true);
  });

  it("validates an agentic benchmark manifest", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "repo-repair",
      version: "1.0.0",
      kind: "agentic",
      primaryMetricId: "pass_ratio",
      metrics: [passRatio],
      requiredCapabilities: ["workspaces", "shell", "files"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a manifest whose primary metric is not defined", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "repo-repair",
      version: "1.0.0",
      kind: "agentic",
      primaryMetricId: "cost",
      metrics: [passRatio],
      requiredCapabilities: ["workspaces"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a benchmark kind outside response and agentic", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "perf",
      version: "1.0.0",
      kind: "performance",
      primaryMetricId: "pass_ratio",
      metrics: [passRatio],
      requiredCapabilities: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("ModelRouteSchema", () => {
  it("validates an OpenRouter model route", () => {
    expect(
      ModelRouteSchema.safeParse({
        id: "default",
        provider: "openrouter",
        model: "anthropic/claude-3.5-sonnet",
      }).success,
    ).toBe(true);
  });
});

describe("ToolsetSchema", () => {
  it("validates a versioned toolset with MCP profiles", () => {
    expect(
      ToolsetSchema.safeParse({
        id: "repo-tools",
        version: "1.0.0",
        tools: ["read_file", "run_tests"],
        mcpProfiles: ["filesystem"],
      }).success,
    ).toBe(true);
  });
});

describe("LimitsSchema", () => {
  it("validates positive duration and token limits", () => {
    expect(
      LimitsSchema.safeParse({
        maxDurationMs: 600000,
        maxToolCalls: 0,
        maxTokens: 200000,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-positive duration limit", () => {
    expect(
      LimitsSchema.safeParse({
        maxDurationMs: 0,
        maxToolCalls: 10,
        maxTokens: 200000,
      }).success,
    ).toBe(false);
  });
});

describe("HarnessManifestSchema", () => {
  it("validates a harness manifest advertising capabilities and routes", () => {
    expect(
      HarnessManifestSchema.safeParse({
        id: "llm-bench",
        version: "1.0.0",
        capabilities: ["response_generation", "workspaces"],
        modelRoutes: [
          { id: "default", provider: "openrouter", model: "openai/gpt-4o" },
        ],
      }).success,
    ).toBe(true);
  });
});
