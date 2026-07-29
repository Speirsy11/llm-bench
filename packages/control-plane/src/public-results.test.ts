import { describe, expect, it } from "vitest";

import type {
  MetricDirection,
  MetricKind,
  RunnerEnvironment,
  RunnerExecution,
} from "@llm-bench/contracts";

import type { PublicExperimentSource } from "./public-results";
import { buildPublicExperimentView } from "./public-results";

describe("buildPublicExperimentView", () => {
  it("separates every execution-defining condition from ranking peers", () => {
    const hash = (value: string) => value.repeat(64);
    const source = experimentSource([
      responseResult({
        id: "baseline",
        model: "openai/gpt-alpha",
        value: 1,
      }),
      responseResult({
        id: "workload",
        model: "openai/gpt-beta",
        prompt: "a materially different prompt",
        value: 1,
      }),
      responseResult({
        id: "limits",
        model: "openai/gpt-gamma",
        maxTokens: 1_999,
        value: 1,
      }),
      responseResult({
        id: "plugin",
        model: "openai/gpt-delta",
        plugin: { protocolVersion: "1.0.0", contentHash: hash("a") },
        value: 1,
      }),
      responseResult({
        id: "mcp",
        model: "openai/gpt-epsilon",
        mcpProfiles: [
          {
            id: "filesystem",
            version: "1.0.0",
            contentHash: hash("b"),
          },
        ],
        value: 1,
      }),
    ]);

    const view = buildPublicExperimentView(source);

    expect(view.comparisonGroups).toHaveLength(5);
    expect(
      view.comparisonGroups.flatMap(({ series }) =>
        series.map(({ id, rank }) => ({ id, rank })),
      ),
    ).toEqual([
      { id: "baseline", rank: null },
      { id: "workload", rank: null },
      { id: "limits", rank: null },
      { id: "plugin", rank: null },
      { id: "mcp", rank: null },
    ]);
  });

  it("separates incompatible conditions before ranking comparable results", () => {
    const source = experimentSource([
      responseResult({
        id: "result-alpha",
        model: "openai/gpt-alpha",
        value: 0.75,
      }),
      responseResult({
        id: "result-beta",
        model: "openai/gpt-beta",
        value: 1,
      }),
      responseResult({
        id: "result-linux",
        model: "openai/gpt-gamma",
        environment: environment({ os: "linux" }),
        value: 0.5,
      }),
      responseResult({
        id: "result-v2",
        model: "openai/gpt-delta",
        benchmarkVersion: "2.0.0",
        value: 1,
      }),
    ]);

    const view = buildPublicExperimentView(source);

    expect(view.comparisonGroups).toHaveLength(3);
    expect(
      view.comparisonGroups.map((group) => group.series.map(({ id }) => id)),
    ).toEqual([
      ["result-alpha", "result-beta"],
      ["result-linux"],
      ["result-v2"],
    ]);
    expect(view.comparisonGroups[0]).toMatchObject({
      benchmark: {
        id: "structured-output",
        version: "1.0.0",
      },
      comparison: {
        changedDimensions: ["model"],
        rankingEligible: true,
      },
      series: [
        { id: "result-alpha", rank: 2, sampleCount: 3 },
        { id: "result-beta", rank: 1, sampleCount: 3 },
      ],
    });
    expect(view.warnings).toContain(
      "Results with different benchmark versions or runner conditions are shown in separate comparison groups.",
    );
  });

  it("publishes measured response observations without invocation metadata or warmups", () => {
    const source = experimentSource([
      responseResult({
        id: "result-samples",
        model: "openai/gpt-alpha",
        value: 2 / 3,
        samples: [
          {
            index: 0,
            observations: [
              { metricId: "schema_compliance", value: 1 },
              { metricId: "duration_ms", value: 120 },
            ],
          },
          {
            index: 1,
            observations: [
              { metricId: "schema_compliance", value: 0 },
              { metricId: "duration_ms", value: 180 },
            ],
          },
          {
            index: 2,
            observations: [
              { metricId: "schema_compliance", value: 1 },
              { metricId: "duration_ms", value: 150 },
            ],
          },
        ],
      }),
    ]);

    const view = buildPublicExperimentView(source);
    const series = view.comparisonGroups[0]?.series[0];

    expect(series?.sampleCount).toBe(3);
    expect(series?.samples).toEqual([
      {
        index: 0,
        observations: [
          { metricId: "schema_compliance", value: 1 },
          { metricId: "duration_ms", value: 120 },
        ],
      },
      {
        index: 1,
        observations: [
          { metricId: "schema_compliance", value: 0 },
          { metricId: "duration_ms", value: 180 },
        ],
      },
      {
        index: 2,
        observations: [
          { metricId: "schema_compliance", value: 1 },
          { metricId: "duration_ms", value: 150 },
        ],
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("requestId");
    expect(JSON.stringify(view)).not.toContain("warmup");
  });

  it("keeps missing values and one-sample ranking limits explicit", () => {
    const view = buildPublicExperimentView(
      experimentSource([
        agenticResult({
          id: "result-typescript",
          metricValue: 1,
        }),
        agenticResult({
          id: "result-python",
          language: "python",
          metricValue: null,
        }),
      ]),
    );

    expect(view.languageBreakdown).toEqual([
      { language: "python", resultCount: 1 },
      { language: "typescript", resultCount: 1 },
    ]);
    expect(view.comparisonGroups).toHaveLength(2);
    expect(view.comparisonGroups[0]?.series[0]).toMatchObject({
      sampleCount: 1,
      rank: null,
      primaryMetric: {
        missing: true,
        value: null,
      },
    });
    expect(view.comparisonGroups[0]?.warnings).toContain(
      "Rankings require at least two measured samples for every target.",
    );
  });

  it("does not treat configured agentic repetitions as observed samples", () => {
    const view = buildPublicExperimentView(
      experimentSource([
        agenticResult({
          id: "result-alpha",
          metricValue: 1,
          repetitions: 3,
        }),
        agenticResult({
          id: "result-beta",
          metricValue: 0.5,
          repetitions: 3,
        }),
      ]),
    );

    expect(
      view.comparisonGroups[0]?.series.map(({ rank, sampleCount }) => ({
        rank,
        sampleCount,
      })),
    ).toEqual([
      { rank: null, sampleCount: 1 },
      { rank: null, sampleCount: 1 },
    ]);
    expect(view.comparisonGroups[0]?.comparison.rankingEligible).toBe(false);
  });

  it("publishes only an allowlisted snapshot and reports every redaction", () => {
    const source = experimentSource(
      [
        responseResult({
          id: "result-private",
          model: "openai/gpt-alpha",
          value: 1,
          artifactCount: 2,
          artifactSummary: {
            kinds: ["response_evidence", "/Users/alice/private/diff"],
            totalBytes: 2048,
          },
          environment: environment({
            cpuClass: "Apple M3 /Users/alice/private",
            runtimeVersions: {
              node: "22.21.0",
              unsafe: "/Users/alice/.tool/version",
            },
          }),
        }),
      ],
      {
        name: "Run by @alice from /Users/alice/project using sk-supersecret",
      },
    );

    const view = buildPublicExperimentView(source);
    const serialized = JSON.stringify(view);

    expect(view.name).toBe(
      "Run by [redacted-user] from [redacted-path] using [redacted-secret]",
    );
    expect(view.sanitization).toMatchObject({
      withheldArtifactCount: 2,
      redactedFields: [
        "experiment.name",
        "runner.cpuClass",
        "runner.runtimeVersions.unsafe",
      ],
    });
    expect(view.comparisonGroups[0]?.series[0]?.artifactSummary).toEqual({
      withheldCount: 2,
      kinds: ["response_evidence"],
      totalBytes: 0,
    });
    expect(serialized).not.toContain("private/diff");
    expect(serialized).not.toContain("@alice");
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("sk-supersecret");
    expect(serialized).not.toContain("fixture prompt is private");
    expect(serialized).not.toContain("sealed-private-ciphertext");
    expect(serialized).not.toContain("c".repeat(64));
    expect(view.comparisonGroups[0]?.key).toMatch(/^comparison-[a-f0-9]{16}$/u);
  });

  it("redacts common credential formats before publication", () => {
    const secrets = [
      "postgresql://admin:hunter2@db.internal/bench",
      ["xoxb", "1234567890", "abcdefghijklmnop"].join("-"),
      "npm_abcdefghijklmnopqrstuvwxyz123456",
      "AKIA1234567890ABCDEF",
      "password=hunter2",
      "Bearer abcdefghijklmnopqrstuvwxyz",
    ];
    const view = buildPublicExperimentView(
      experimentSource(
        [
          responseResult({
            id: "result-secrets",
            model: "openai/gpt-alpha",
            value: 1,
          }),
        ],
        { name: secrets.join(" ") },
      ),
    );
    const serialized = JSON.stringify(view);

    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(view.sanitization.redactedFields).toContain("experiment.name");
    expect(view.name).toContain("[redacted-secret-url]");
    expect(view.name).toContain("[redacted-secret]");
  });

  it("ranks lower-is-better ties and labels unregistered metrics literally", () => {
    const durationJobs = [
      withPrimaryMetric(
        responseResult({
          id: "duration-alpha",
          model: "openai/gpt-alpha",
          value: 1,
        }),
        metric({
          id: "duration_ms",
          value: 420,
          kind: "duration",
          unit: "ms",
          direction: "lower_is_better",
        }),
      ),
      withPrimaryMetric(
        responseResult({
          id: "duration-beta",
          model: "openai/gpt-beta",
          value: 1,
        }),
        metric({
          id: "duration_ms",
          value: 380,
          kind: "duration",
          unit: "ms",
          direction: "lower_is_better",
        }),
      ),
      withPrimaryMetric(
        responseResult({
          id: "duration-gamma",
          model: "openai/gpt-gamma",
          value: 1,
        }),
        metric({
          id: "duration_ms",
          value: 380,
          kind: "duration",
          unit: "ms",
          direction: "lower_is_better",
        }),
      ),
    ];
    const ranked = buildPublicExperimentView(experimentSource(durationJobs));

    expect(
      ranked.comparisonGroups[0]?.series.map(({ id, rank }) => ({ id, rank })),
    ).toEqual([
      { id: "duration-alpha", rank: 3 },
      { id: "duration-beta", rank: 1 },
      { id: "duration-gamma", rank: 1 },
    ]);

    const unknown = buildPublicExperimentView(
      experimentSource([
        withPrimaryMetric(
          responseResult({
            id: "unknown-metric",
            model: "openai/gpt-alpha",
            value: 1,
          }),
          metric({
            id: "novel_score",
            value: 7,
            kind: "count",
            unit: "points",
            direction: "higher_is_better",
          }),
        ),
      ]),
    );
    expect(unknown.comparisonGroups[0]?.series[0]?.primaryMetric).toMatchObject(
      {
        id: "novel_score",
        label: "Novel Score",
      },
    );
  });

  it("separates incompatible MCP implementations and keeps public identity", () => {
    const view = buildPublicExperimentView(
      experimentSource([
        responseResult({
          id: "configuration-alpha",
          model: "openai/gpt-alpha",
          value: 0.75,
        }),
        responseResult({
          id: "configuration-beta",
          model: "openai/gpt-beta",
          harnessId: "codex",
          toolsetId: "native-mcp",
          mcpProfiles: [
            {
              id: "gitlab",
              version: "2.0.0",
              contentHash: "f".repeat(64),
            },
            {
              id: "github",
              version: "1.0.0",
              contentHash: "e".repeat(64),
            },
          ],
          value: 1,
        }),
      ]),
    );

    expect(view.comparisonGroups).toHaveLength(2);
    expect(view.comparisonGroups[1]).toMatchObject({
      comparison: { changedDimensions: [] },
      series: [
        {
          target: {
            toolset: {
              mcpProfiles: [
                { id: "gitlab", version: "2.0.0" },
                { id: "github", version: "1.0.0" },
              ],
            },
          },
        },
      ],
    });
  });

  it("labels provider, tool inventory, and MCP changes as target variables", () => {
    const view = buildPublicExperimentView(
      experimentSource([
        responseResult({
          id: "target-shape-alpha",
          model: "shared-model",
          provider: "openrouter",
          tools: ["read_file"],
          mcpProfiles: [
            {
              id: "github",
              version: "1.0.0",
              contentHash: "e".repeat(64),
            },
          ],
          value: 0.75,
        }),
        responseResult({
          id: "target-shape-beta",
          model: "shared-model",
          provider: "openai",
          tools: ["read_file", "apply_patch"],
          mcpProfiles: [
            {
              id: "github",
              version: "1.0.0",
              contentHash: "e".repeat(64),
            },
          ],
          value: 1,
        }),
      ]),
    );

    expect(view.comparisonGroups[0]?.comparison.changedDimensions).toEqual([
      "model",
      "toolset",
    ]);
    expect(view.comparisonGroups[0]?.warnings).toEqual([
      "This comparison changes model, toolset; interpret it as a configuration comparison, not an isolated variable effect.",
    ]);
  });

  it("uses an explicit generic primary metric for unknown legacy results", () => {
    const base = responseResult({
      id: "legacy-missing",
      model: "legacy/model",
      value: 1,
    });
    if (base.result === null) throw new Error("Expected a persisted result.");
    const unreported: PublicExperimentSource["jobs"][number] = {
      ...base,
      result: {
        ...base.result,
        primaryMetricId: "unreported_metric",
        metrics: [],
      },
    };
    const unknownBenchmark: PublicExperimentSource["jobs"][number] = {
      ...base,
      id: "job-unknown-benchmark",
      benchmarkId: "unknown-benchmark",
      result: null,
    };

    const view = buildPublicExperimentView(
      experimentSource([unreported, unknownBenchmark]),
    );

    expect(
      view.comparisonGroups.map((group) => group.series[0]?.primaryMetric),
    ).toEqual([
      {
        id: "unreported_metric",
        label: "Primary metric",
        kind: "count",
        unit: "count",
        direction: "higher_is_better",
        value: null,
        missing: true,
      },
      {
        id: "primary_metric",
        label: "Primary metric",
        kind: "count",
        unit: "count",
        direction: "higher_is_better",
        value: null,
        missing: true,
      },
    ]);
  });
});

function experimentSource(
  jobs: PublicExperimentSource["jobs"],
  overrides: Partial<Omit<PublicExperimentSource, "jobs">> = {},
): PublicExperimentSource {
  return {
    id: "experiment-public",
    name: "Curated comparison",
    createdAt: new Date("2026-07-01T09:00:00.000Z"),
    curatedAt: new Date("2026-07-02T09:00:00.000Z"),
    jobs,
    ...overrides,
  };
}

function responseResult({
  id,
  model,
  value,
  benchmarkVersion = "1.0.0",
  environment: runnerEnvironment = environment(),
  artifactCount = 0,
  artifactSummary,
  harnessId = "llmbench",
  toolsetId = "response",
  provider = "openrouter",
  tools = [],
  mcpProfiles = [],
  samples,
  prompt = "fixture prompt is private",
  maxTokens = 2_000,
  plugin,
}: {
  id: string;
  model: string;
  value: number | null;
  benchmarkVersion?: string;
  environment?: RunnerEnvironment;
  artifactCount?: number;
  artifactSummary?: {
    readonly kinds: readonly string[];
    readonly totalBytes: number;
  };
  harnessId?: string;
  toolsetId?: string;
  provider?: string;
  tools?: string[];
  mcpProfiles?: {
    id: string;
    version: string;
    contentHash: string;
  }[];
  prompt?: string;
  maxTokens?: number;
  plugin?: {
    protocolVersion: string;
    contentHash: string;
  };
  samples?: NonNullable<
    PublicExperimentSource["jobs"][number]["result"]
  >["samples"];
}): PublicExperimentSource["jobs"][number] {
  return resultSource({
    id,
    benchmarkId: "structured-output",
    benchmarkVersion,
    execution: {
      workload: {
        kind: "response",
        case: {
          id: "customer-record",
          prompt,
          repetitions: 3,
        },
      },
      target: {
        modelRoute: {
          id: `route-${id}`,
          provider,
          model,
        },
        harness: {
          id: harnessId,
          version: "1.0.0",
          capabilities: ["response_generation"],
          modelRoutes: [],
        },
        toolset: {
          id: toolsetId,
          version: "1.0.0",
          tools,
          mcpProfiles,
        },
        ...(plugin ? { plugin } : {}),
      },
      limits: {
        maxDurationMs: 30_000,
        maxToolCalls: 0,
        maxTokens,
        maxTurns: 1,
      },
      credential: {
        profileId: "00000000-0000-4000-8000-000000000001",
        provider: "openrouter",
        sealed: {
          algorithm: "x25519-xsalsa20poly1305-seal",
          runnerId: "00000000-0000-4000-8000-000000000002",
          keyFingerprint: "AAAAAAAAAAAAAAAAAAAAAA==",
          ciphertext: "sealed-private-ciphertext".padEnd(68, "x"),
        },
      },
    },
    runnerEnvironment,
    metrics: [
      metric({
        id: "schema_compliance",
        value,
        kind: "ratio",
        unit: "ratio",
        direction: "higher_is_better",
      }),
      metric({
        id: "duration_ms",
        value: 420,
        kind: "duration",
        unit: "ms",
        direction: "lower_is_better",
      }),
      metric({
        id: "cost_usd",
        value: null,
        kind: "currency",
        unit: "USD",
        direction: "lower_is_better",
      }),
    ],
    primaryMetricId: "schema_compliance",
    artifactCount,
    artifactSummary,
    samples:
      samples ??
      [0, 1, 2].map((index) => ({
        index,
        observations:
          value === null ? [] : [{ metricId: "schema_compliance", value }],
      })),
  });
}

function agenticResult({
  id,
  language = "typescript",
  metricValue,
  repetitions = 1,
}: {
  id: string;
  language?: "typescript" | "python";
  metricValue: number | null;
  repetitions?: number;
}): PublicExperimentSource["jobs"][number] {
  return resultSource({
    id,
    benchmarkId: "repository-repair",
    benchmarkVersion: "1.0.0",
    execution: {
      workload: {
        kind: "agentic",
        task: {
          id: `repair-${language}`,
          language,
          constraints: ["private constraint"],
          repetitions,
        },
        fixtureContentHash: "a".repeat(64),
        graderHash: "b".repeat(64),
      },
      target: {
        modelRoute: {
          id: `route-${id}`,
          provider: "openrouter",
          model: "openai/gpt-alpha",
        },
        harness: {
          id: "llmbench",
          version: "1.0.0",
          capabilities: ["response_generation", "workspaces", "files"],
          modelRoutes: [],
        },
        toolset: {
          id: "builtin",
          version: "1.0.0",
          tools: ["read_file", "write_file"],
          mcpProfiles: [],
        },
      },
      limits: {
        maxDurationMs: 30_000,
        maxToolCalls: 10,
        maxTokens: 10_000,
        maxTurns: 10,
      },
      credential: null,
    },
    runnerEnvironment: environment(),
    metrics: [
      metric({
        id: "hidden_test_pass_ratio",
        value: metricValue,
        kind: "ratio",
        unit: "ratio",
        direction: "higher_is_better",
      }),
    ],
    primaryMetricId: "hidden_test_pass_ratio",
  });
}

function resultSource({
  id,
  benchmarkId,
  benchmarkVersion,
  execution,
  runnerEnvironment,
  metrics,
  primaryMetricId,
  artifactCount = 0,
  artifactSummary,
  samples,
}: {
  id: string;
  benchmarkId: string;
  benchmarkVersion: string;
  execution: RunnerExecution;
  runnerEnvironment: RunnerEnvironment;
  metrics: NonNullable<
    PublicExperimentSource["jobs"][number]["result"]
  >["metrics"];
  primaryMetricId: string;
  artifactCount?: number;
  artifactSummary?: {
    readonly kinds: readonly string[];
    readonly totalBytes: number;
  };
  samples?: NonNullable<
    PublicExperimentSource["jobs"][number]["result"]
  >["samples"];
}): PublicExperimentSource["jobs"][number] {
  return {
    id: `job-${id}`,
    createdAt: new Date(`2026-07-01T09:00:0${id.length % 10}.000Z`),
    status: "completed",
    benchmarkId,
    benchmarkVersion,
    execution,
    runnerEnvironment,
    result: {
      id,
      primaryMetricId,
      createdAt: new Date(`2026-07-01T10:00:0${id.length % 10}.000Z`),
      metrics,
      artifactCount,
      artifactSummary,
      samples: samples ?? [],
    },
  };
}

function metric({
  id,
  value,
  kind,
  unit,
  direction,
}: {
  id: string;
  value: number | null;
  kind: MetricKind;
  unit: string;
  direction: MetricDirection;
}) {
  return { id, value, kind, unit, direction };
}

function withPrimaryMetric(
  job: PublicExperimentSource["jobs"][number],
  primaryMetric: NonNullable<
    PublicExperimentSource["jobs"][number]["result"]
  >["metrics"][number],
): PublicExperimentSource["jobs"][number] {
  if (job.result === null) throw new Error("Expected a persisted result.");
  return {
    ...job,
    result: {
      ...job.result,
      primaryMetricId: primaryMetric.id,
      metrics: [
        primaryMetric,
        ...job.result.metrics.filter(({ id }) => id !== primaryMetric.id),
      ],
    },
  };
}

function environment(
  overrides: Partial<RunnerEnvironment> = {},
): RunnerEnvironment {
  return {
    os: "darwin",
    architecture: "arm64",
    cpuClass: "Apple M3",
    memoryMb: 16_384,
    runtimeVersions: { node: "22.21.0" },
    harnessVersions: {
      llmbench: "1.0.0",
      codex: "1.2.0",
    },
    sandboxMode: "workspace-write",
    contentHashes: { runner: "c".repeat(64) },
    ...overrides,
  };
}
