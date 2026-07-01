import { describe, expect, it } from "vitest";

import type { RunnerIdentity } from "@llm-bench/crypto";
import { generateRunnerKeyPair, sealCredential } from "@llm-bench/crypto";
import { OpenRouterProvider } from "@llm-bench/openai-compatible";

import { LlmBenchHarness } from "./agent-loop";
import { CredentialResolver } from "./credential-resolver";

async function runner(runnerId: string): Promise<RunnerIdentity> {
  return { runnerId, ...(await generateRunnerKeyPair()) };
}

const OPENROUTER_KEY = "sk-or-canary-integration-key";

function fixtureFetch(capture: { authorization?: string; body?: string }) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    capture.authorization = (init.headers as Record<string, string>).authorization;
    capture.body = init.body as string;
    expect(input).toBe("https://openrouter.ai/api/v1/chat/completions");
    return new Response(
      JSON.stringify({
        model: "anthropic/claude-3.5-sonnet",
        choices: [{ message: { content: "The answer is 42." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

describe("sealed credential drives a fixture-backed harness turn", () => {
  it("GREEN: runner A decrypts in memory and completes a turn", async () => {
    const runnerA = await runner("runner-a");
    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: OPENROUTER_KEY,
    });

    // Runner A opens the credential locally and hands it to the provider only.
    const resolver = new CredentialResolver(runnerA, { openrouter: sealed });
    const apiKey = await resolver.resolve("openrouter");

    const capture: { authorization?: string; body?: string } = {};
    const provider = new OpenRouterProvider({ apiKey, fetch: fixtureFetch(capture) });

    const harness = new LlmBenchHarness({
      provider,
      model: "anthropic/claude-3.5-sonnet",
      root: "/repo",
      limits: { maxTurns: 3, maxToolCalls: 3, maxDurationMs: 30_000 },
      secrets: [apiKey.reveal()],
    });

    const result = await harness.run({
      messages: [{ role: "user", content: "What is the answer?" }],
    });

    expect(result.status).toBe("completed");
    expect(result.messages.at(-1)?.content).toBe("The answer is 42.");
    expect(result.usage.totalTokens).toBe(18);

    // The secret reaches the wire only in the Authorization header.
    expect(capture.authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
    expect(capture.body).not.toContain("canary");
    // The secret never appears in the serialized run result.
    expect(JSON.stringify(result)).not.toContain("canary");
  });

  it("RED: a different runner cannot resolve the credential to drive a call", async () => {
    const runnerA = await runner("runner-a");
    const runnerB = await runner("runner-b");
    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: OPENROUTER_KEY,
    });

    const resolver = new CredentialResolver(runnerB, { openrouter: sealed });
    await expect(resolver.resolve("openrouter")).rejects.toMatchObject({
      reason: "wrong-runner",
    });
  });
});
