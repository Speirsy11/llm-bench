import { describe, expect, it } from "vitest";

import {
  ArtifactVersionSchema,
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

describe("ArtifactVersionSchema", () => {
  it("accepts full SemVer and rejects non-canonical artifact versions", () => {
    expect(ArtifactVersionSchema.safeParse("1.2.3-rc.1+build.7").success).toBe(
      true,
    );
    expect(ArtifactVersionSchema.safeParse("1.2.3+sha.abcdef").success).toBe(
      true,
    );
    expect(ArtifactVersionSchema.safeParse("01.2.3").success).toBe(false);
    expect(ArtifactVersionSchema.safeParse("1.2").success).toBe(false);
    expect(ArtifactVersionSchema.safeParse("1.2.3-01").success).toBe(false);
  });
});

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
        mcpProfiles: [
          {
            id: "filesystem",
            version: "1.2.0",
            contentHash:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("applies full SemVer to toolset and MCP profile versions", () => {
    expect(
      ToolsetSchema.safeParse({
        id: "repo-tools",
        version: "2.0.0-rc.1+build.7",
        tools: ["read_file"],
        mcpProfiles: [
          {
            id: "filesystem",
            version: "1.2.0-beta.2+sha.abcdef",
            contentHash:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      ToolsetSchema.safeParse({
        id: "repo-tools",
        version: "02.0.0",
        tools: [],
        mcpProfiles: [],
      }).success,
    ).toBe(false);

    expect(
      ToolsetSchema.safeParse({
        id: "repo-tools",
        version: "2.0.0",
        tools: [],
        mcpProfiles: [
          {
            id: "filesystem",
            version: "01.0.0",
            contentHash:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("LimitsSchema", () => {
  it("validates positive duration and token limits", () => {
    expect(
      LimitsSchema.safeParse({
        maxDurationMs: 600000,
        maxToolCalls: 0,
        maxTokens: 200000,
        maxTurns: 20,
      }).success,
    ).toBe(true);
  });

  it("rejects a non-positive duration limit", () => {
    expect(
      LimitsSchema.safeParse({
        maxDurationMs: 0,
        maxToolCalls: 10,
        maxTokens: 200000,
        maxTurns: 20,
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
