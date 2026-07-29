import { parseWebEnv } from "@/env";

import type { PublicExperimentView } from "@llm-bench/control-plane";
import { createDatabase } from "@llm-bench/control-plane";

import { rejectUnauthorizedE2eRequest, requireTestDatabaseUrl } from "../guard";

const EXPERIMENT_ID = "13000000-0000-4000-8000-000000000013";
const FIXTURE_USER_ID = "e2e-showcase-curator";
const CURATED_AT = "2026-07-28T12:00:00.000Z";

const snapshot: PublicExperimentView = {
  schemaVersion: 1,
  id: EXPERIMENT_ID,
  name: "Tool-use models under identical conditions",
  createdAt: "2026-07-28T10:00:00.000Z",
  curatedAt: CURATED_AT,
  comparisonGroups: [
    {
      key: "structured-output-1.0.0-linux",
      benchmark: {
        id: "structured-output",
        version: "1.0.0",
        caseId: "customer-record",
        language: null,
      },
      environment: {
        os: "linux",
        architecture: "x64",
        cpuClass: "CI reference runner",
        memoryMb: 8192,
        runtimeVersions: { node: "22.21.0" },
        harnessVersions: { llmbench: "1.0.0" },
        sandboxMode: "isolated-workspace",
      },
      comparison: {
        changedDimensions: ["model"],
        rankingEligible: true,
      },
      warnings: [],
      series: [
        {
          id: "fixture-result-alpha",
          jobId: "fixture-job-alpha",
          createdAt: "2026-07-28T10:04:00.000Z",
          label: "openai/gpt-alpha · LLMBench",
          target: {
            model: { provider: "openai", id: "gpt-alpha" },
            harness: { id: "llmbench", version: "1.0.0" },
            toolset: {
              id: "response",
              version: "1.0.0",
              tools: [],
              mcpProfiles: [],
            },
          },
          primaryMetric: {
            id: "schema_compliance",
            label: "Schema compliance",
            kind: "ratio",
            unit: "ratio",
            direction: "higher_is_better",
            value: 1,
            missing: false,
          },
          metrics: [
            {
              id: "schema_compliance",
              label: "Schema compliance",
              kind: "ratio",
              unit: "ratio",
              direction: "higher_is_better",
              value: 1,
              missing: false,
            },
            {
              id: "duration_ms",
              label: "Duration",
              kind: "duration",
              unit: "ms",
              direction: "lower_is_better",
              value: 28_400,
              missing: false,
            },
            {
              id: "cost_usd",
              label: "Provider cost",
              kind: "currency",
              unit: "USD",
              direction: "lower_is_better",
              value: 0.0184,
              missing: false,
            },
          ],
          artifactSummary: {
            withheldCount: 1,
            kinds: ["response_evidence"],
            totalBytes: 6144,
          },
          samples: [1, 1, 1].map((value, index) => ({
            index,
            observations: [
              { metricId: "schema_compliance", value },
              { metricId: "duration_ms", value: 27_900 + index * 500 },
            ],
          })),
          sampleCount: 3,
          status: "completed",
          rank: 1,
        },
        {
          id: "fixture-result-beta",
          jobId: "fixture-job-beta",
          createdAt: "2026-07-28T10:11:00.000Z",
          label: "anthropic/claude-beta · LLMBench",
          target: {
            model: { provider: "anthropic", id: "claude-beta" },
            harness: { id: "llmbench", version: "1.0.0" },
            toolset: {
              id: "response",
              version: "1.0.0",
              tools: [],
              mcpProfiles: [],
            },
          },
          primaryMetric: {
            id: "schema_compliance",
            label: "Schema compliance",
            kind: "ratio",
            unit: "ratio",
            direction: "higher_is_better",
            value: 0.67,
            missing: false,
          },
          metrics: [
            {
              id: "schema_compliance",
              label: "Schema compliance",
              kind: "ratio",
              unit: "ratio",
              direction: "higher_is_better",
              value: 0.67,
              missing: false,
            },
            {
              id: "duration_ms",
              label: "Duration",
              kind: "duration",
              unit: "ms",
              direction: "lower_is_better",
              value: 21_900,
              missing: false,
            },
            {
              id: "cost_usd",
              label: "Provider cost",
              kind: "currency",
              unit: "USD",
              direction: "lower_is_better",
              value: 0.0127,
              missing: false,
            },
          ],
          artifactSummary: {
            withheldCount: 1,
            kinds: ["response_evidence"],
            totalBytes: 5120,
          },
          samples: [0.5, 0.75, 0.75].map((value, index) => ({
            index,
            observations: [
              { metricId: "schema_compliance", value },
              { metricId: "duration_ms", value: 21_400 + index * 500 },
            ],
          })),
          sampleCount: 3,
          status: "completed",
          rank: 2,
        },
      ],
    },
    {
      key: "repository-repair-1.0.0-python-linux",
      benchmark: {
        id: "repository-repair",
        version: "1.0.0",
        caseId: "clamp-boundaries",
        language: "python",
      },
      environment: {
        os: "linux",
        architecture: "x64",
        cpuClass: "CI reference runner",
        memoryMb: 8192,
        runtimeVersions: { python: "3.13.5" },
        harnessVersions: { llmbench: "1.0.0" },
        sandboxMode: "isolated-workspace",
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
          id: "fixture-result-missing",
          jobId: "fixture-job-missing",
          createdAt: "2026-07-28T10:18:00.000Z",
          label: "openai/gpt-alpha · LLMBench",
          target: {
            model: { provider: "openai", id: "gpt-alpha" },
            harness: { id: "llmbench", version: "1.0.0" },
            toolset: {
              id: "workspace",
              version: "1.0.0",
              tools: ["read_file", "apply_patch", "run_tests"],
              mcpProfiles: [],
            },
          },
          primaryMetric: {
            id: "hidden_test_pass_ratio",
            label: "Hidden Test Pass Ratio",
            kind: "ratio",
            unit: "ratio",
            direction: "higher_is_better",
            value: null,
            missing: true,
          },
          metrics: [],
          artifactSummary: {
            withheldCount: 0,
            kinds: [],
            totalBytes: 0,
          },
          samples: [],
          sampleCount: 1,
          status: "failed",
          rank: null,
        },
      ],
    },
  ],
  languageBreakdown: [{ language: "python", resultCount: 1 }],
  warnings: [
    "Results with different benchmark versions or runner conditions are shown in separate comparison groups.",
  ],
  sanitization: {
    withheldArtifactCount: 2,
    redactedFields: ["experiment.name"],
    excludedFields: [
      "artifact.blobPath",
      "credential",
      "experiment.ownerId",
      "runner.name",
      "workload.prompt",
    ],
  },
};

export async function POST(request: Request): Promise<Response> {
  const rejection = rejectUnauthorizedE2eRequest(request);
  if (rejection) return rejection;
  const connectionString = requireTestDatabaseUrl(
    parseWebEnv(process.env).databaseUrl,
  );
  const database = createDatabase(connectionString);
  try {
    await database.client.unsafe(
      `insert into users (id, github_id, github_login)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [FIXTURE_USER_ID, "e2e-showcase-github", "e2e-showcase"],
    );
    await database.client.unsafe(
      `insert into experiments
         (id, owner_id, name, visibility, curated_at, curated_by, configuration_snapshot, public_snapshot)
       values ($1, $2, $3, 'public', $4, $2, '{}'::jsonb, $5::jsonb)
       on conflict (id) do update set
         name = excluded.name,
         visibility = excluded.visibility,
         curated_at = excluded.curated_at,
         curated_by = excluded.curated_by,
         public_snapshot = excluded.public_snapshot,
         updated_at = now()`,
      [
        EXPERIMENT_ID,
        FIXTURE_USER_ID,
        snapshot.name,
        CURATED_AT,
        JSON.stringify(snapshot),
      ],
    );
    return Response.json({ experimentId: EXPERIMENT_ID });
  } finally {
    await database.close();
  }
}
