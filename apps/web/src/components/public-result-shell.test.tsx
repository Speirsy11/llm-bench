import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublicExperimentView } from "@llm-bench/control-plane";

import { PublicResultShell } from "./public-result-shell";

describe("PublicResultShell", () => {
  it("renders an authenticated analysis workspace without public-page framing", () => {
    const html = renderToStaticMarkup(
      <PublicResultShell context="private" result={publicResultFixture()} />,
    );

    expect(html).toContain("Private analysis");
    expect(html).toContain("Your experiment evidence");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Back to dashboard");
    expect(html).toContain("Sanitized analysis view");
    expect(html).not.toContain("Curated public evidence");
    expect(html).not.toContain("Public results");
    expect(html).not.toContain("Open workspace");
    expect(html).not.toContain("public inspection");
    expect(html).not.toContain("Public pages");
  });

  it("renders charts with exact table fallbacks and explicit conditions", () => {
    const html = renderToStaticMarkup(
      <PublicResultShell result={publicResultFixture()} />,
    );

    expect(html).toContain("Structured output comparison");
    expect(html).toContain("How to read this result");
    expect(html).toContain("Comparable group 1");
    expect(html).toContain("Schema compliance aggregate ranking");
    expect(html).toContain("Schema compliance measured samples");
    expect(html).toMatch(/<svg[^>]*role="img"/u);
    expect(html).toContain("Exact values");
    expect(html).toContain("openai/gpt-alpha");
    expect(html).toContain("openai/gpt-beta");
    expect(html).toContain("openrouter/openai/gpt-alpha");
    expect(html).toContain("n=3");
    expect(html).toContain("Ordered measured response samples");
    expect(html).toContain("Repetition");
    expect(html).toContain("Schema compliance: 0.5");
    expect(html).toContain("Quality vs time");
    expect(html).toContain("Quality vs cost");
    expect(html).toContain("Harness duration");
    expect(html).toContain("Provider cost");
    expect(html).toContain("Trajectories and chronological results");
    expect(html).toContain("One aggregate result; no trajectory yet.");
    expect(html).toContain("Diff evidence summary");
    expect(html).toContain("response_evidence");
    expect(html).toContain("Raw contents");
    expect(html).toContain("Changed variable: model");
    expect(html).toContain("Case and conditions");
    expect(html).toContain("customer-record");
    expect(html).toContain("LLMBench 1.0.0");
    expect(html).toContain("Apple M3");
    expect(html).toContain("MCP profiles");
    expect(html).toContain("filesystem 2.0.0");
  });

  it("displays ranking-eligible charts and exact values in rank order", () => {
    const html = renderToStaticMarkup(
      <PublicResultShell result={publicResultFixture()} />,
    );
    const rankingChart =
      /<svg[^>]*aria-labelledby="ranking-chart-title-1 ranking-chart-description-1"[\s\S]*?<\/svg>/u.exec(
        html,
      )?.[0];
    const distributionChart =
      /<svg[^>]*aria-labelledby="distribution-chart-title-1 distribution-chart-description-1"[\s\S]*?<\/svg>/u.exec(
        html,
      )?.[0];
    const exactValues =
      /<table[^>]*aria-label="Exact values"[\s\S]*?<\/table>/u.exec(html)?.[0];

    expect(rankingChart).toBeDefined();
    expect(distributionChart).toBeDefined();
    expect(exactValues).toBeDefined();
    expect(
      rankingChart?.indexOf("openrouter/openai/gpt-beta: rank 1"),
    ).toBeLessThan(
      rankingChart?.indexOf("openrouter/openai/gpt-alpha: rank 2") ?? -1,
    );
    expect(
      distributionChart?.indexOf(
        "openrouter/openai/gpt-beta: 3 measured samples",
      ),
    ).toBeLessThan(
      distributionChart?.indexOf(
        "openrouter/openai/gpt-alpha: 3 measured samples",
      ) ?? -1,
    );
    expect(exactValues?.indexOf("openrouter/openai/gpt-beta")).toBeLessThan(
      exactValues?.indexOf("openrouter/openai/gpt-alpha") ?? -1,
    );
  });

  it("keeps missing and incompatible data visible without inventing ranks", () => {
    const fixture = publicResultFixture();
    const firstGroup = fixture.comparisonGroups[0];
    const firstSeries = firstGroup?.series[0];
    if (!firstGroup || !firstSeries) {
      throw new Error("Expected a comparison fixture.");
    }
    const incomplete: PublicExperimentView = {
      ...fixture,
      warnings: [
        "Results with different benchmark versions or runner conditions are shown in separate comparison groups.",
      ],
      comparisonGroups: [
        firstGroup,
        {
          ...firstGroup,
          key: "linux-group",
          environment: {
            ...firstGroup.environment,
            os: "linux",
          },
          comparison: {
            changedDimensions: [],
            rankingEligible: false,
          },
          warnings: [
            "Rankings require at least two measured samples for every target.",
            "Missing primary metrics remain visible and are excluded from ranking.",
          ],
          series: [
            {
              ...firstSeries,
              id: "result-missing",
              rank: null,
              sampleCount: 1,
              primaryMetric: {
                ...firstSeries.primaryMetric,
                value: null,
                missing: true,
              },
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <PublicResultShell result={incomplete} />,
    );

    expect(html).toContain("Separate comparison groups");
    expect(html).toContain("Comparable group 2");
    expect(html).toContain("Not ranked");
    expect(html).toContain("Missing");
    expect(html).toContain("n=1");
  });

  it("does not present lower-is-better performance as a quality axis", () => {
    const fixture = publicResultFixture();
    const group = fixture.comparisonGroups[0];
    if (!group) throw new Error("Expected a comparison fixture.");
    const performanceResult: PublicExperimentView = {
      ...fixture,
      comparisonGroups: [
        {
          ...group,
          series: group.series.map((series) => ({
            ...series,
            primaryMetric:
              series.metrics.find(({ id }) => id === "duration_ms") ??
              series.primaryMetric,
          })),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <PublicResultShell result={performanceResult} />,
    );

    expect(html).toContain(
      "Quality-versus-time needs a higher-is-better primary metric",
    );
    expect(html).toContain(
      "Quality-versus-cost needs a higher-is-better primary metric",
    );
    expect(html).not.toContain("Quality versus time</title>");
  });

  it("does not invent a repetition distribution for agentic results", () => {
    const fixture = publicResultFixture();
    const group = fixture.comparisonGroups[0];
    if (!group) throw new Error("Expected a comparison fixture.");

    const html = renderToStaticMarkup(
      <PublicResultShell
        result={{
          ...fixture,
          comparisonGroups: [
            {
              ...group,
              benchmark: {
                ...group.benchmark,
                id: "repository-repair",
                language: "typescript",
              },
              series: group.series.map((series) => ({
                ...series,
                samples: [],
                sampleCount: 1,
              })),
            },
          ],
        }}
      />,
    );

    expect(html).toContain(
      "No repetition-level response evidence is available for this group.",
    );
    expect(html).not.toContain("Ordered measured response samples");
  });

  it("explains repeated target improvement and large evidence without hiding absent runtime details", () => {
    const fixture = publicResultFixture();
    const group = fixture.comparisonGroups[0];
    const first = group?.series[0];
    if (!group || !first) throw new Error("Expected a comparison fixture.");
    const repeated: PublicExperimentView = {
      ...fixture,
      comparisonGroups: [
        {
          ...group,
          environment: { ...group.environment, runtimeVersions: {} },
          series: [
            first,
            {
              ...first,
              id: "alpha-later",
              jobId: "job-alpha-later",
              createdAt: "2026-07-03T10:00:00.000Z",
              primaryMetric: { ...first.primaryMetric, value: 1 },
              artifactSummary: {
                withheldCount: 1,
                kinds: ["patch_diff"],
                totalBytes: 2 * 1024 * 1024,
              },
            },
            {
              ...first,
              id: "alpha-unchanged",
              jobId: "job-alpha-unchanged",
              createdAt: "2026-07-04T10:00:00.000Z",
              primaryMetric: { ...first.primaryMetric, value: 1 },
            },
            {
              ...first,
              id: "alpha-small-improvement",
              jobId: "job-alpha-small-improvement",
              createdAt: "2026-07-04T11:00:00.000Z",
              primaryMetric: { ...first.primaryMetric, value: 1.004 },
            },
            {
              ...first,
              id: "alpha-regressed",
              jobId: "job-alpha-regressed",
              createdAt: "2026-07-05T10:00:00.000Z",
              primaryMetric: { ...first.primaryMetric, value: 0.5 },
            },
            {
              ...first,
              id: "short-target",
              jobId: "job-short-target",
              target: {
                ...first.target,
                model: { provider: "p", id: "x" },
              },
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(<PublicResultShell result={repeated} />);

    expect(html).toContain("5 chronological aggregate results");
    expect(html).toContain("+25% · improved");
    expect(html).toContain("0% · unchanged");
    expect(html).toContain("+0.4% · improved");
    expect(html).toContain("-50.4% · regressed");
    expect(html).toContain("2.0 MB");
    expect(html).toContain("Not reported");
    expect(html).toContain("p/x");
    expect(html).toContain("Harness versions");
    expect(html).toContain("llmbench 1.0.0");
    expect(html).toContain("Compatibility fingerprint");
    expect(html).toContain(group.key);
  });

  it("shows language and sanitization summaries without exposing artifacts", () => {
    const html = renderToStaticMarkup(
      <PublicResultShell
        result={{
          ...publicResultFixture(),
          languageBreakdown: [
            { language: "python", resultCount: 2 },
            { language: "typescript", resultCount: 3 },
          ],
          sanitization: {
            withheldArtifactCount: 4,
            redactedFields: ["experiment.name"],
            excludedFields: ["artifact.blobPath", "workload.prompt"],
          },
        }}
      />,
    );

    expect(html).toContain("Language breakdown");
    expect(html).toContain("Python");
    expect(html).toContain("TypeScript");
    expect(html).toContain("4 private artifacts withheld");
    expect(html).toContain("1 field redacted");
    expect(html).not.toContain("artifact.blobPath");
    expect(html).not.toContain("workload.prompt");
  });
});

function publicResultFixture(): PublicExperimentView {
  const environment = {
    os: "darwin" as const,
    architecture: "arm64",
    cpuClass: "Apple M3",
    memoryMb: 16_384,
    runtimeVersions: { node: "22.21.0" },
    harnessVersions: { llmbench: "1.0.0" },
    sandboxMode: "workspace-write",
  };
  const schemaMetric = {
    id: "schema_compliance",
    label: "Schema compliance",
    kind: "ratio" as const,
    unit: "ratio",
    direction: "higher_is_better" as const,
    value: 0.75,
    missing: false,
  };
  const durationMetric = {
    id: "duration_ms",
    label: "Harness duration",
    kind: "duration" as const,
    unit: "ms",
    direction: "lower_is_better" as const,
    value: 420,
    missing: false,
  };
  const costMetric = {
    id: "cost_usd",
    label: "Provider cost",
    kind: "currency" as const,
    unit: "USD",
    direction: "lower_is_better" as const,
    value: 0.015,
    missing: false,
  };
  const series = (id: string, model: string, value: number, rank: number) => ({
    id,
    jobId: `job-${id}`,
    createdAt:
      id === "alpha" ? "2026-07-01T10:00:00.000Z" : "2026-07-01T10:05:00.000Z",
    label: `${model} · llmbench · response`,
    target: {
      model: { provider: "openrouter", id: model },
      harness: { id: "llmbench", version: "1.0.0" },
      toolset: {
        id: "response",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [{ id: "filesystem", version: "2.0.0" }],
      },
    },
    primaryMetric: { ...schemaMetric, value },
    metrics: [
      { ...schemaMetric, value },
      {
        ...durationMetric,
        value: id === "alpha" ? 420 : 380,
      },
      {
        ...costMetric,
        value: id === "alpha" ? 0.015 : 0.011,
      },
    ],
    artifactSummary: {
      withheldCount: id === "alpha" ? 1 : 0,
      kinds: id === "alpha" ? ["response_evidence"] : [],
      totalBytes: id === "alpha" ? 2048 : 0,
    },
    samples: (id === "alpha" ? [1, 0.5, 0.75] : [1, 1, 1]).map(
      (sampleValue, index) => ({
        index,
        observations: [
          { metricId: "schema_compliance", value: sampleValue },
          {
            metricId: "duration_ms",
            value: id === "alpha" ? 400 + index * 20 : 360 + index * 20,
          },
        ],
      }),
    ),
    sampleCount: 3,
    status: "completed" as const,
    rank,
  });

  return {
    schemaVersion: 1,
    id: "experiment-public",
    name: "Structured output comparison",
    createdAt: "2026-07-01T09:00:00.000Z",
    curatedAt: "2026-07-02T09:00:00.000Z",
    comparisonGroups: [
      {
        key: "darwin-v1",
        benchmark: {
          id: "structured-output",
          version: "1.0.0",
          caseId: "customer-record",
          language: null,
        },
        environment,
        comparison: {
          changedDimensions: ["model"],
          rankingEligible: true,
        },
        warnings: [],
        series: [
          series("alpha", "openai/gpt-alpha", 0.75, 2),
          series("beta", "openai/gpt-beta", 1, 1),
        ],
      },
    ],
    languageBreakdown: [],
    warnings: [],
    sanitization: {
      withheldArtifactCount: 0,
      redactedFields: [],
      excludedFields: ["artifact.blobPath", "credential", "workload.prompt"],
    },
  };
}
