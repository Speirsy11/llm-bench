import { describe, expect, it } from "vitest";

import { PiHarness } from "./pi-harness";

/**
 * Opt-in live smoke test. Not run in ordinary CI.
 *
 * Set LLMBENCH_LIVE_PI=1 and ensure the `pi` binary is on PATH
 * with valid credentials.
 */
describe("PiHarness live smoke", () => {
  const binary = process.env.PI_BINARY ?? "pi";
  const enabled = process.env.LLMBENCH_LIVE_PI === "1";

  it.runIf(enabled)("probe reports the live Pi CLI version", async () => {
    const harness = new PiHarness({ binary });
    const result = await harness.probe();

    expect(result).toMatchObject({ available: true });
    expect(result.version).toBeTruthy();
    expect(typeof result.version).toBe("string");
    expect(result.version).not.toBe("unknown");
  });

  it.runIf(enabled)("completes a simple response request", async () => {
    const harness = new PiHarness({ binary });

    const result = await harness.run({
      mode: "response",
      jobId: "live-smoke-pi",
      caseId: "smoke-response",
      prompt: 'Respond with exactly the word "LLMBench" and nothing else.',
      workspaceRoot: process.cwd(),
      benchmark: { id: "structured-output", version: "1.0.0" },
      modelRouteId: "gpt-4o",
      toolset: { id: "none", version: "1.0.0", tools: [], mcpProfiles: [] },
      limits: { maxDurationMs: 30_000, maxToolCalls: 0, maxTokens: 100 },
      checkpoint: null,
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatch(/LLMBench/i);
  });
});
