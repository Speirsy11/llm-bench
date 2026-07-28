import type { RunnerLease } from "@llm-bench/contracts";
import {
  DEFAULT_FIXTURE_ID,
  repairFixture,
  repairScenario,
} from "@llm-bench/repository-repair";

/** A protocol-v2 lease for tests that exercise transport rather than execution. */
export function runnerLeaseFixture(
  overrides: Partial<RunnerLease> = {},
): RunnerLease {
  const fixture = repairFixture(DEFAULT_FIXTURE_ID);
  const modelRoute = {
    id: "fixture-model",
    provider: "openrouter",
    model: "openai/gpt-5-mini",
  };
  return {
    jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
    attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
    leaseToken: "lease-token",
    benchmark: { id: "repository-repair", version: "1.0.0" },
    execution: {
      workload: {
        kind: "agentic",
        task: repairScenario(DEFAULT_FIXTURE_ID).task,
        fixtureContentHash: fixture.contentHash,
        graderHash: fixture.graderHash,
      },
      target: {
        modelRoute,
        harness: {
          id: "llmbench",
          version: "1.0.0",
          capabilities: ["response_generation", "workspaces", "files"],
          modelRoutes: [modelRoute],
        },
        toolset: {
          id: "repository",
          version: "1.0.0",
          tools: ["read_file", "list_directory", "search_files", "apply_patch"],
          mcpProfiles: [],
        },
      },
      limits: {
        maxDurationMs: 10_000,
        maxToolCalls: 4,
        maxTokens: 1_000,
        maxTurns: 3,
      },
      credential: null,
    },
    queuePosition: 0,
    checkpoint: null,
    cancellationRequested: false,
    ...overrides,
  };
}
