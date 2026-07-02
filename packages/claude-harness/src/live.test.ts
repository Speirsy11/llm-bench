import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ClaudeHarness } from "./claude-harness";

/**
 * Opt-in live smoke test. Not run in ordinary CI.
 *
 * Set LLMBENCH_LIVE_CLAUDE=1 and ensure the `claude` binary is on PATH
 * with valid credentials.
 */
describe("ClaudeHarness live smoke", () => {
  const binary = process.env.CLAUDE_BINARY ?? "claude";
  const enabled = process.env.LLMBENCH_LIVE_CLAUDE === "1";

  it.runIf(enabled)("probe reports the live Claude CLI version", async () => {
    const harness = new ClaudeHarness({ binary });
    const result = await harness.probe();

    expect(result).toMatchObject({ available: true });
    expect(result.version).toBeTruthy();
    expect(typeof result.version).toBe("string");
    expect(result.version).not.toBe("unknown");
  });

  it.runIf(enabled)("completes a simple response request", async () => {
    const harness = new ClaudeHarness({ binary, ephemeral: true });

    const result = await harness.run({
      mode: "response",
      jobId: "live-smoke",
      caseId: "smoke-response",
      prompt: 'Respond with exactly the word "LLMBench" and nothing else.',
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "claude-sonnet-4-6",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 30_000, maxToolCalls: 0, maxTokens: 100 },
      checkpoint: null,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatch(/LLMBench/i);
  });

  it.runIf(enabled)(
    "completes an agentic workspace request with file writes",
    async () => {
      const harness = new ClaudeHarness({ binary });

      const result = await harness.run({
        mode: "agentic",
        jobId: "live-smoke-agentic",
        caseId: "smoke-workspace",
        prompt:
          'Create a file called "smoke-output.txt" containing exactly "EPIC-10-claude" and nothing else.',
        workspaceRoot: process.cwd(),
        benchmark: { id: "repository-repair", version: "1.0.0" },
        modelRouteId: "claude-sonnet-4-6",
        toolset: {
          id: "native",
          version: "1.0.0",
          tools: [],
          mcpProfiles: [],
        },
        limits: { maxDurationMs: 60_000, maxToolCalls: 10, maxTokens: 1_000 },
        checkpoint: null,
      });

      expect(result.status).toBe("completed");

      try {
        const contents = await readFile("smoke-output.txt", "utf8");
        expect(contents.trim()).toBe("EPIC-10-claude");
      } finally {
        // Clean up after test
        try {
          const { rm } = await import("node:fs/promises");
          await rm("smoke-output.txt", { force: true });
        } catch {
          // best effort
        }
      }
    },
  );
});
