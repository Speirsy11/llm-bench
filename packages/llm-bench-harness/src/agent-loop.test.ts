import { describe, expect, it, vi } from "vitest";

import type {
  CompletionRequest,
  CompletionResult,
  Usage,
} from "@llm-bench/openai-compatible";
import { ProviderError } from "@llm-bench/openai-compatible";

import type { AgentTool, HarnessProvider } from "./types";
import { LlmBenchHarness } from "./agent-loop";

const UNKNOWN_USAGE: Usage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
};

function completion(partial: Partial<CompletionResult>): CompletionResult {
  return {
    content: "",
    toolCalls: [],
    finishReason: "stop",
    usage: UNKNOWN_USAGE,
    model: "test-model",
    ...partial,
  };
}

type Step = CompletionResult | Error | (() => Promise<CompletionResult>);

class ScriptedProvider implements HarnessProvider {
  calls = 0;
  lastRequest: CompletionRequest | null = null;
  constructor(private readonly steps: Step[]) {}
  async complete(
    request: CompletionRequest,
    options: { signal?: AbortSignal },
  ): Promise<CompletionResult> {
    this.lastRequest = request;
    if (options.signal?.aborted) throw abortError();
    const step = this.steps[this.calls++];
    if (step === undefined) throw new Error("provider ran out of scripted steps");
    if (typeof step === "function") return step();
    if (step instanceof Error) throw step;
    return step;
  }
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function echoTool(): AgentTool {
  return {
    definition: {
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: { text: { type: "string" } } },
    },
    execute: (rawArguments) =>
      Promise.resolve(String((JSON.parse(rawArguments) as { text: string }).text)),
  };
}

const limits = { maxTurns: 5, maxToolCalls: 5, maxDurationMs: 60_000 };

describe("LlmBenchHarness", () => {
  it("stops on completion and returns the assistant message", async () => {
    const provider = new ScriptedProvider([completion({ content: "done" })]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
      systemPrompt: "be helpful",
    });

    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });

    expect(result.status).toBe("completed");
    expect(result.turns).toBe(1);
    expect(result.messages[0]).toEqual({ role: "system", content: "be helpful" });
    expect(result.messages.at(-1)).toMatchObject({ role: "assistant", content: "done" });
    expect(result.events.at(-1)).toEqual({ type: "stop", reason: "completed" });
  });

  it("runs a tool loop and aggregates usage", async () => {
    const provider = new ScriptedProvider([
      completion({
        toolCalls: [{ id: "c1", name: "echo", arguments: '{"text":"pong"}' }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      completion({
        content: "final",
        usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
      }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits,
    });

    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toBe(1);
    expect(result.usage).toEqual({ promptTokens: 14, completionTokens: 6, totalTokens: 20 });
    const toolResult = result.events.find((e) => e.type === "tool-result");
    expect(toolResult).toMatchObject({ name: "echo", content: "pong", ok: true });
    expect(provider.lastRequest?.tools).toHaveLength(1);
  });

  it("reports failed tool executions without crashing the loop", async () => {
    const provider = new ScriptedProvider([
      completion({
        toolCalls: [
          { id: "c1", name: "missing", arguments: "{}" },
          { id: "c2", name: "echo", arguments: "not json" },
        ],
      }),
      completion({ content: "recovered" }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits,
    });

    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    const results = result.events.filter((e) => e.type === "tool-result");
    expect(results[0]).toMatchObject({ ok: false, content: "Unknown tool: missing" });
    expect(results[1]).toMatchObject({ ok: false });
    expect(result.status).toBe("completed");
  });

  it("stops at the turn limit", async () => {
    const provider = new ScriptedProvider(
      Array.from({ length: 3 }, () =>
        completion({ toolCalls: [{ id: "c", name: "echo", arguments: '{"text":"x"}' }] }),
      ),
    );
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits: { maxTurns: 2, maxToolCalls: 10, maxDurationMs: 60_000 },
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("max_turns");
    expect(result.turns).toBe(2);
  });

  it("halts mid tool loop when the deadline passes between tool calls", async () => {
    let clock = 0;
    const provider = new ScriptedProvider([
      completion({
        toolCalls: [
          { id: "c1", name: "echo", arguments: '{"text":"a"}' },
          { id: "c2", name: "echo", arguments: '{"text":"b"}' },
        ],
      }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits: { maxTurns: 5, maxToolCalls: 5, maxDurationMs: 1000 },
      // now() calls: deadline(0), timer(0), turn-halt(0), tool-1-halt(0),
      // tool-2-halt(2000 → past the 1000 deadline).
      now: () => {
        const times = [0, 0, 0, 0, 2000];
        const value = times[Math.min(clock, times.length - 1)]!;
        clock += 1;
        return value;
      },
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("timeout");
    expect(result.toolCalls).toBe(1);
  });

  it("stringifies non-Error tool rejections", async () => {
    const throwingTool: AgentTool = {
      definition: { name: "boom", description: "b", parameters: { type: "object" } },
      execute: () =>
        Promise.reject({
          toString: () => "plain string failure",
        } as unknown as Error),
    };
    const provider = new ScriptedProvider([
      completion({ toolCalls: [{ id: "c1", name: "boom", arguments: "{}" }] }),
      completion({ content: "done" }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [throwingTool],
      limits,
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    const toolResult = result.events.find((e) => e.type === "tool-result");
    expect(toolResult).toMatchObject({ ok: false, content: "plain string failure" });
  });

  it("stops at the tool-call limit", async () => {
    const provider = new ScriptedProvider([
      completion({
        toolCalls: [
          { id: "c1", name: "echo", arguments: '{"text":"a"}' },
          { id: "c2", name: "echo", arguments: '{"text":"b"}' },
        ],
      }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits: { maxTurns: 5, maxToolCalls: 1, maxDurationMs: 60_000 },
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("max_tool_calls");
    expect(result.toolCalls).toBe(1);
  });

  it("cancels before any provider call when the signal is already aborted", async () => {
    const provider = new ScriptedProvider([completion({ content: "unused" })]);
    const controller = new AbortController();
    controller.abort();
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
      signal: controller.signal,
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("cancelled");
    expect(result.turns).toBe(0);
    expect(provider.calls).toBe(0);
  });

  it("cancels when the provider is aborted mid-flight", async () => {
    const provider = new ScriptedProvider([() => Promise.reject(abortError())]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("cancelled");
  });

  it("times out between turns using the injected clock", async () => {
    let clock = 0;
    const provider = new ScriptedProvider([
      completion({ toolCalls: [{ id: "c", name: "echo", arguments: '{"text":"x"}' }] }),
      completion({ content: "never reached" }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits: { maxTurns: 5, maxToolCalls: 5, maxDurationMs: 1000 },
      now: () => {
        const value = clock;
        clock += 600;
        return value;
      },
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("timeout");
  });

  it("times out when the deadline fires during a provider call", async () => {
    const provider = new ScriptedProvider([
      (): Promise<CompletionResult> =>
        new Promise((_resolve, reject) => setTimeout(() => reject(abortError()), 40)),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits: { maxTurns: 5, maxToolCalls: 5, maxDurationMs: 5 },
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("timeout");
  });

  it("surfaces provider errors as an error status", async () => {
    const provider = new ScriptedProvider([
      new ProviderError("rate limited", "rate_limit", true, 429),
    ]);
    const harness = new LlmBenchHarness({ provider, model: "m", root: "/repo", limits });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("error");
    expect(result.error).toBe("rate limited");
    expect(result.events.at(-1)).toMatchObject({ type: "stop", reason: "error" });
  });

  it("surfaces non-provider errors with a string message", async () => {
    const provider = new ScriptedProvider([new TypeError("boom")]);
    const harness = new LlmBenchHarness({ provider, model: "m", root: "/repo", limits });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("error");
    expect(result.error).toContain("boom");
  });

  it("redacts secret canaries from events and messages", async () => {
    const secret = "sk-or-canary-abc";
    const provider = new ScriptedProvider([
      completion({
        content: `leak ${secret}`,
        toolCalls: [{ id: "c1", name: "echo", arguments: `{"text":"${secret}"}` }],
      }),
      completion({ content: "ok" }),
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      tools: [echoTool()],
      limits,
      secrets: [secret],
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });

    const serialized = JSON.stringify({ events: result.events, messages: result.messages });
    expect(serialized).not.toContain("sk-or-canary");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts secrets from error details", async () => {
    const secret = "sk-or-canary-err";
    const provider = new ScriptedProvider([new Error(`failed with ${secret}`)]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
      secrets: [secret],
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.error).not.toContain("canary");
    const stop = result.events.at(-1);
    expect(stop).toMatchObject({ type: "stop", reason: "error" });
    expect(JSON.stringify(stop)).not.toContain("canary");
  });

  it("keeps usage null when the provider reports no metadata", async () => {
    const provider = new ScriptedProvider([completion({ content: "done" })]);
    const harness = new LlmBenchHarness({ provider, model: "m", root: "/repo", limits });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.usage).toEqual(UNKNOWN_USAGE);
  });

  it("cancels when the external signal aborts during a provider call", async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const provider = new ScriptedProvider([
      () => {
        // Abort mid-flight so the external-signal listener aborts the run.
        controller.abort();
        return Promise.reject(abortError());
      },
    ]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
      signal: controller.signal,
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("cancelled");
    expect(removeSpy).toHaveBeenCalled();
  });

  it("completes when a provided signal never aborts", async () => {
    const controller = new AbortController();
    const provider = new ScriptedProvider([completion({ content: "done" })]);
    const harness = new LlmBenchHarness({
      provider,
      model: "m",
      root: "/repo",
      limits,
      signal: controller.signal,
    });
    const result = await harness.run({ messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("completed");
  });
});
