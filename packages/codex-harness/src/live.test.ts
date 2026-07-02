import { describe, expect, it } from "vitest";

import { CodexHarness } from "./codex-harness";

const liveModel = process.env.LLMBENCH_LIVE_CODEX_MODEL ?? "";

describe.runIf(process.env.LLMBENCH_LIVE_CODEX === "1" && liveModel.length > 0)(
  "CodexHarness live smoke",
  () => {
    it("completes an ephemeral read-only response with local Codex auth", async () => {
      const harness = new CodexHarness({ ephemeral: true });
      const probe = await harness.probe();
      expect(probe.available).toBe(true);

      const result = await harness.run({
        mode: "response",
        jobId: "live-smoke",
        caseId: "response",
        prompt: "Return exactly LLMBENCH_CODEX_SMOKE_OK and nothing else.",
        workspaceRoot: process.cwd(),
        benchmark: { id: "live-smoke", version: "1.0.0" },
        modelRouteId: liveModel,
        toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
        limits: {
          maxDurationMs: 120_000,
          maxToolCalls: 0,
          maxTokens: 100,
        },
        checkpoint: null,
      });

      expect(result.status).toBe("completed");
      expect(result.output.trim()).toBe("LLMBENCH_CODEX_SMOKE_OK");
      expect(result.checkpoint).toBeNull();
    });
  },
);
