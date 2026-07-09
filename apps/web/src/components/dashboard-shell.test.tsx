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
        preview={{
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
        }}
        runners={[
          {
            id: "runner-1",
            ownerId: "user-1",
            name: "M2 runner",
            publicKey: "public-key",
            capabilities: ["workspaces", "files"],
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
    expect(html).toContain("projected jobs");
    expect(html).toContain("Hidden test pass ratio");
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
        preview={null}
        runners={[]}
      />,
    );

    expect(html).toContain("No paired runner yet.");
    expect(html).toContain("No credential profile yet.");
    expect(html).toContain("Pair a runner and save a credential first.");
    expect(html).toContain("No matrix preview yet.");
    expect(html).toContain("No experiments launched.");
  });

  it("renders matrix blockers, active cancellation, and retry controls", () => {
    const html = renderToStaticMarkup(
      <DashboardShell
        credentialProfiles={[credentialProfileFixture()]}
        experiments={[
          {
            id: "experiment-2",
            name: "Blocked repair",
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
        preview={{
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
        }}
        runners={[runnerFixture({ status: "offline" })]}
      />,
    );

    expect(html).toContain("Jobs active");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain("limited is missing files.");
    expect(html).toContain("Resolve matrix blockers before launching.");
    expect(html).not.toContain("Launch experiment");
    expect(html).toContain("Cancel");
    expect(html).toContain("Retry");
    expect(html).toContain("unknown");
    expect(html).toContain("cancelled · retry");
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

function runnerFixture({
  status = "online",
}: {
  readonly status?: "offline" | "online" | "disabled";
} = {}) {
  return {
    id: "runner-1",
    ownerId: "user-1",
    name: "M2 runner",
    publicKey: "public-key",
    capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
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
