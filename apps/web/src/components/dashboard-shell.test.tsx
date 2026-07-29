import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("renders the signed-in user's dashboard tracer workspace", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[
          {
            id: "credential-1",
            ownerId: "user-1",
            runnerId: "runner-1",
            label: "OpenRouter production",
            provider: "openrouter",
            maskedSecret: "sk-or-v1...abcd",
            sealedCredential: {},
            createdAt: new Date("2026-07-09T09:00:00.000Z"),
            updatedAt: new Date("2026-07-09T09:00:00.000Z"),
          },
        ]}
        experiments={[
          {
            id: "experiment-1",
            name: "Repository repair",
            visibility: "private",
            curatedAt: null,
            progress: {
              totalJobs: 1,
              queuedJobs: 0,
              runningJobs: 0,
              completedJobs: 1,
              failedJobs: 0,
              cancelledJobs: 0,
              interruptedJobs: 0,
            },
            jobs: [
              {
                id: "job-1",
                status: "completed",
                retryOfJobId: null,
                cancellationRequested: false,
                benchmark: {
                  id: "repository-repair",
                  kind: "agentic",
                  targetKind: "workspace",
                },
                target: {
                  position: 0,
                  modelRoute: {
                    id: "openrouter-gpt-4o",
                    provider: "openrouter",
                    model: "openai/gpt-4o",
                  },
                  harness: {
                    id: "llmbench",
                    version: "1.0.0",
                    capabilities: ["workspaces", "files"],
                    modelRoutes: [
                      {
                        id: "openrouter-gpt-4o",
                        provider: "openrouter",
                        model: "openai/gpt-4o",
                      },
                    ],
                  },
                  toolset: {
                    id: "builtin",
                    version: "1.0.0",
                    tools: [],
                    mcpProfiles: [],
                  },
                },
                primaryMetric: {
                  id: "hidden_test_pass_ratio",
                  label: "Hidden test pass ratio",
                  kind: "ratio",
                  unit: "ratio",
                  direction: "higher_is_better",
                  value: 1,
                },
              },
            ],
          },
        ]}
        githubLogin="speirsy11"
        name="Charlie"
        previews={{
          llmbench: {
            input: {
              name: "Repository repair",
              runnerId: "runner-1",
              credentialProfileId: "credential-1",
              modelRoutes: [
                {
                  id: "openrouter-gpt-4o",
                  provider: "openrouter",
                  model: "openai/gpt-4o",
                },
              ],
              harnesses: [
                {
                  id: "llmbench",
                  version: "1.0.0",
                  capabilities: ["workspaces", "files"],
                  modelRoutes: [
                    {
                      id: "openrouter-gpt-4o",
                      provider: "openrouter",
                      model: "openai/gpt-4o",
                    },
                  ],
                },
              ],
              toolsets: [
                {
                  id: "builtin",
                  version: "1.0.0",
                  tools: [],
                  mcpProfiles: [],
                },
              ],
            },
            projectedJobCount: 1,
            spend: { kind: "unknown" },
            canLaunch: true,
            blockers: [],
            order: [
              {
                position: 0,
                modelRouteId: "openrouter-gpt-4o",
                harnessId: "llmbench",
                toolsetId: "builtin",
                requiredCapabilities: ["workspaces", "files"],
              },
            ],
          },
        }}
        runners={[
          {
            id: "runner-1",
            ownerId: "user-1",
            name: "M2 runner",
            publicKey: "public-key",
            capabilities: ["workspaces", "files"],
            inventory: { plugins: [], mcpProfiles: [] },
            environment: {
              os: "darwin",
              architecture: "arm64",
              cpuClass: "m2",
              memoryMb: 16384,
              runtimeVersions: { node: "22.21.0" },
              harnessVersions: { fixture: "1.0.0" },
              sandboxMode: "process",
              contentHashes: {},
            },
            revokedAt: null,
            status: "online",
            lastSeenAt: new Date("2026-07-09T09:00:00.000Z"),
          },
        ]}
      />,
    );

    expect(html).toContain("Good to see you, Charlie");
    expect(html).toContain("M2 runner");
    expect(html).toContain("OpenRouter production");
    expect(html).toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="llmbench")(?=[^>]*checked="")[^>]*>/u,
    );
    expect(html).not.toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="codex")[^>]*>/u,
    );
    expect(html).not.toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="claude")[^>]*>/u,
    );
    expect(html).not.toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="pi")[^>]*>/u,
    );
    expect(html).toContain("projected job");
    expect(html).toContain("Hidden test pass ratio");
    expect(html).toContain("repository-repair · workspace target");
    expect(html).toContain("Open charts and evidence");
    expect(html).toContain('href="/dashboard/results/experiment-1"');
    expect(html).toMatch(
      new RegExp("Hidden test pass ratio:[\\s\\S]*>1</span>"),
    );
  });

  it("renders empty states before runner pairing and credential setup", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[]}
        experiments={[]}
        githubLogin="speirsy11"
        name="Charlie"
        previews={{}}
        runners={[]}
      />,
    );

    expect(html).toContain("No paired runner yet.");
    expect(html).toContain("No credential profile yet.");
    expect(html).toContain("Pair a runner before launching.");
    expect(html).toContain("No matrix preview yet.");
    expect(html).toContain("No experiments launched.");
  });

  it("offers an explicit runner choice and marks the selected runner", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[]}
        experiments={[]}
        githubLogin="speirsy11"
        name="Charlie"
        previews={{}}
        runners={[
          runnerFixture({ id: "runner-1", name: "First runner" }),
          runnerFixture({ id: "runner-2", name: "Second runner" }),
        ]}
        selectedRunnerId="runner-2"
      />,
    );

    expect(html).toContain("First runner");
    expect(html).toContain("Second runner");
    expect(html).toContain('href="/dashboard?runnerId=runner-1"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Selected");
  });

  it("offers native-auth launch without a hosted credential", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[]}
        experiments={[]}
        githubLogin="speirsy11"
        name="Charlie"
        previews={{ codex: nativePreviewFixture() }}
        runners={[runnerFixture()]}
      />,
    );

    expect(html).toContain("Launch experiment");
    expect(html).not.toContain('name="credentialProfileId"');
    expect(html).toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="codex")(?=[^>]*checked="")[^>]*>/u,
    );
    expect(html).not.toMatch(
      /<input(?=[^>]*name="harness")(?=[^>]*value="llmbench")[^>]*>/u,
    );
  });

  it("renders matrix blockers, active cancellation, and retry controls", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[credentialProfileFixture()]}
        experiments={[
          {
            id: "experiment-2",
            name: "Blocked repair",
            visibility: "private",
            curatedAt: null,
            progress: {
              totalJobs: 3,
              queuedJobs: 1,
              runningJobs: 0,
              completedJobs: 0,
              failedJobs: 1,
              cancelledJobs: 1,
              interruptedJobs: 0,
            },
            jobs: [
              jobFixture({ id: "job-queued", status: "queued" }),
              jobFixture({
                id: "job-cancelled",
                status: "cancelled",
                retryOfJobId: "job-original",
              }),
              jobFixture({
                id: "job-failed",
                status: "failed",
                primaryMetric: {
                  id: "hidden_test_pass_ratio",
                  label: "Hidden test pass ratio",
                  kind: "ratio",
                  unit: "ratio",
                  direction: "higher_is_better",
                  value: null,
                },
              }),
            ],
          },
        ]}
        githubLogin="speirsy11"
        name="Charlie"
        previews={{
          llmbench: {
            input: {
              name: "Blocked repair",
              runnerId: "runner-1",
              credentialProfileId: "credential-1",
              modelRoutes: [
                {
                  id: "openrouter-gpt-4o",
                  provider: "openrouter",
                  model: "openai/gpt-4o",
                },
              ],
              harnesses: [
                {
                  id: "limited",
                  version: "1.0.0",
                  capabilities: ["workspaces"],
                  modelRoutes: [
                    {
                      id: "openrouter-gpt-4o",
                      provider: "openrouter",
                      model: "openai/gpt-4o",
                    },
                  ],
                },
              ],
              toolsets: [
                {
                  id: "builtin",
                  version: "1.0.0",
                  tools: [],
                  mcpProfiles: [],
                },
              ],
            },
            projectedJobCount: 1,
            spend: { kind: "unknown" },
            canLaunch: false,
            blockers: ["limited is missing files."],
            order: [
              {
                position: 0,
                modelRouteId: "openrouter-gpt-4o",
                harnessId: "limited",
                toolsetId: "builtin",
                requiredCapabilities: ["workspaces", "files"],
              },
            ],
          },
        }}
        runners={[runnerFixture({ status: "offline" })]}
      />,
    );

    expect(html).toContain("Jobs active");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("limited is missing files.");
    expect(html).toContain("Resolve matrix blockers before launching.");
    expect(html).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*type="submit")[^>]*>Launch experiment<\/button>/u,
    );
    expect(html).toContain("Cancel");
    expect(html).toContain("Retry");
    expect(html).toContain("unknown");
    expect(html).toContain("cancelled · retry");
    expect(html).not.toContain("Open charts and evidence");
  });

  it("shows the administrator-only curation workflow and privacy report", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[]}
        curateExperimentAction={() => undefined}
        curationPreviews={{
          "experiment-public-candidate": {
            canPublish: true,
            blockers: [],
            fingerprint: "a".repeat(64),
            view: {
              schemaVersion: 1,
              id: "experiment-public-candidate",
              name: "Candidate [redacted-user]",
              createdAt: "2026-07-28T10:00:00.000Z",
              curatedAt: "2026-07-28T12:00:00.000Z",
              comparisonGroups: [
                {
                  key: "comparison-safe-123",
                  benchmark: {
                    id: "structured-output",
                    version: "1.0.0",
                    caseId: "customer-record",
                    language: "typescript",
                  },
                  environment: {
                    os: "darwin",
                    architecture: "arm64",
                    cpuClass: "apple-silicon",
                    memoryMb: 32768,
                    runtimeVersions: { node: "22.21.0" },
                    harnessVersions: { llmbench: "1.0.0" },
                    sandboxMode: "workspace-write",
                  },
                  comparison: {
                    changedDimensions: ["model"],
                    rankingEligible: true,
                  },
                  warnings: ["One result has partial artifact evidence."],
                  series: [
                    {
                      id: "result-safe-1",
                      jobId: "job-safe-1",
                      createdAt: "2026-07-28T11:00:00.000Z",
                      label: "OpenRouter Alpha",
                      target: {
                        model: {
                          provider: "openrouter",
                          id: "openai/gpt-alpha",
                        },
                        harness: { id: "llmbench", version: "1.0.0" },
                        toolset: {
                          id: "response",
                          version: "1.0.0",
                          tools: ["structured-output"],
                          mcpProfiles: [
                            { id: "public-docs", version: "2.0.0" },
                          ],
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
                      ],
                      artifactSummary: {
                        withheldCount: 2,
                        kinds: ["response_evidence"],
                        totalBytes: 2048,
                      },
                      samples: [
                        {
                          index: 0,
                          observations: [
                            { metricId: "schema_compliance", value: 1 },
                          ],
                        },
                      ],
                      sampleCount: 1,
                      status: "completed",
                      rank: 1,
                    },
                  ],
                },
              ],
              languageBreakdown: [{ language: "typescript", resultCount: 1 }],
              warnings: ["Public snapshot warning."],
              sanitization: {
                withheldArtifactCount: 2,
                redactedFields: ["experiment.name"],
                excludedFields: ["workload.prompt", "credential"],
              },
            },
          },
        }}
        experiments={[
          {
            id: "experiment-public-candidate",
            name: "Candidate comparison",
            visibility: "private",
            curatedAt: null,
            progress: {
              totalJobs: 1,
              queuedJobs: 0,
              runningJobs: 0,
              completedJobs: 1,
              failedJobs: 0,
              cancelledJobs: 0,
              interruptedJobs: 0,
            },
            jobs: [completedJobFixture()],
          },
          {
            id: "experiment-public",
            name: "Published comparison",
            visibility: "public",
            curatedAt: new Date("2026-07-28T12:00:00.000Z"),
            progress: {
              totalJobs: 1,
              queuedJobs: 0,
              runningJobs: 0,
              completedJobs: 1,
              failedJobs: 0,
              cancelledJobs: 0,
              interruptedJobs: 0,
            },
            jobs: [completedJobFixture()],
          },
        ]}
        githubLogin="octoadmin"
        isAdmin
        name="Admin"
        previews={{}}
        runners={[]}
        withdrawExperimentAction={() => undefined}
      />,
    );

    expect(html).toContain("Public curation");
    expect(html).toContain("Publish curated result");
    expect(html).toContain("Sanitized publication preview");
    expect(html).toContain("Candidate [redacted-user]");
    expect(html).toContain("Withheld artifacts");
    expect(html).toContain("experiment.name");
    expect(html).toContain("comparison-safe-123");
    expect(html).toContain("customer-record");
    expect(html).toContain("apple-silicon");
    expect(html).toContain("node=22.21.0");
    expect(html).toContain("llmbench=1.0.0");
    expect(html).toContain("openai/gpt-alpha");
    expect(html).toContain("public-docs · 2.0.0");
    expect(html).toContain("schema_compliance=1");
    expect(html).toContain("response_evidence");
    expect(html).toContain("Public snapshot warning.");
    expect(html).toContain("I reviewed this sanitized preview");
    expect(html).toContain('name="curationConfirmed"');
    expect(html).toContain('name="curationFingerprint"');
    expect(html).toContain(`value="${"a".repeat(64)}"`);
    expect(html).toContain("workload.prompt, credential");
    expect(html).toContain("Private prompts and artifacts are withheld");
    expect(html).toContain('href="/results/experiment-public"');
    expect(html).toContain("Withdraw from public");
  });
});

function credentialProfileFixture() {
  return {
    id: "credential-1",
    ownerId: "user-1",
    runnerId: "runner-1",
    label: "OpenRouter production",
    provider: "openrouter",
    maskedSecret: "sk-or-v1...abcd",
    sealedCredential: {},
    createdAt: new Date("2026-07-09T09:00:00.000Z"),
    updatedAt: new Date("2026-07-09T09:00:00.000Z"),
  };
}

function nativePreviewFixture() {
  const modelRoute = {
    id: "codex-gpt-5.4",
    provider: "codex",
    model: "gpt-5.4",
  };
  const harness = {
    id: "codex",
    version: "1.0.0",
    capabilities: [
      "response_generation",
      "workspaces",
      "files",
      "session_resume",
    ] as ("response_generation" | "workspaces" | "files" | "session_resume")[],
    modelRoutes: [modelRoute],
  };
  const toolset = {
    id: "native",
    version: "1.0.0",
    tools: [],
    mcpProfiles: [],
  };
  return {
    input: {
      name: "Repository repair",
      runnerId: "runner-1",
      modelRoutes: [modelRoute],
      harnesses: [harness],
      toolsets: [toolset],
    },
    projectedJobCount: 1,
    spend: { kind: "unknown" as const },
    canLaunch: true,
    blockers: [],
    order: [
      {
        position: 0,
        modelRouteId: modelRoute.id,
        harnessId: harness.id,
        toolsetId: toolset.id,
        requiredCapabilities: [
          "response_generation",
          "workspaces",
          "files",
        ] as const,
      },
    ],
  };
}

function runnerFixture({
  id = "runner-1",
  name = "M2 runner",
  status = "online",
}: {
  readonly id?: string;
  readonly name?: string;
  readonly status?: "offline" | "online" | "disabled";
} = {}) {
  return {
    id,
    ownerId: "user-1",
    name,
    publicKey: "public-key",
    capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
    inventory: { plugins: [], mcpProfiles: [] },
    environment: {
      os: "darwin" as const,
      architecture: "arm64",
      cpuClass: "m2",
      memoryMb: 16384,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions: { fixture: "1.0.0" },
      sandboxMode: "process",
      contentHashes: {},
    },
    revokedAt: null,
    status,
    lastSeenAt: new Date("2026-07-09T09:00:00.000Z"),
  };
}

function jobFixture({
  id,
  primaryMetric = null,
  retryOfJobId = null,
  status,
}: {
  readonly id: string;
  readonly primaryMetric?: {
    readonly id: string;
    readonly label: string;
    readonly kind: "ratio";
    readonly unit: string;
    readonly direction: "higher_is_better";
    readonly value: number | null;
  } | null;
  readonly retryOfJobId?: string | null;
  readonly status: "queued" | "failed" | "cancelled";
}) {
  return {
    id,
    status,
    retryOfJobId,
    cancellationRequested: false,
    benchmark: {
      id: "repository-repair",
      kind: "agentic" as const,
      targetKind: "workspace" as const,
    },
    target: {
      position: 0,
      modelRoute: {
        id: "openrouter-gpt-4o",
        provider: "openrouter",
        model: "openai/gpt-4o",
      },
      harness: {
        id: "llmbench",
        version: "1.0.0",
        capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
        modelRoutes: [
          {
            id: "openrouter-gpt-4o",
            provider: "openrouter",
            model: "openai/gpt-4o",
          },
        ],
      },
      toolset: {
        id: "builtin",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [],
      },
    },
    primaryMetric,
  };
}

function completedJobFixture() {
  return {
    id: "job-completed",
    status: "completed" as const,
    retryOfJobId: null,
    cancellationRequested: false,
    benchmark: {
      id: "repository-repair",
      kind: "agentic" as const,
      targetKind: "workspace" as const,
    },
    target: {
      position: 0,
      modelRoute: {
        id: "openrouter-gpt-4o",
        provider: "openrouter",
        model: "openai/gpt-4o",
      },
      harness: {
        id: "llmbench",
        version: "1.0.0",
        capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
        modelRoutes: [],
      },
      toolset: {
        id: "builtin",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [],
      },
    },
    primaryMetric: {
      id: "hidden_test_pass_ratio",
      label: "Hidden test pass ratio",
      kind: "ratio" as const,
      unit: "ratio",
      direction: "higher_is_better" as const,
      value: 1,
    },
  };
}
