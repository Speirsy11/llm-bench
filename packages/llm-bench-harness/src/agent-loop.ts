import type {
  ChatMessage,
  ToolCall,
  ToolDefinition,
  Usage,
} from "@llm-bench/openai-compatible";
import { redactSecrets } from "@llm-bench/crypto";
import { ProviderError } from "@llm-bench/openai-compatible";

import type {
  AgentTool,
  HarnessEvent,
  HarnessLimits,
  HarnessProvider,
  HarnessRunResult,
  HarnessStopReason,
} from "./types";

export interface HarnessConfig {
  provider: HarnessProvider;
  model: string;
  tools?: AgentTool[];
  limits: HarnessLimits;
  root: string;
  systemPrompt?: string;
  /** External cancellation signal. */
  signal?: AbortSignal;
  /** Injectable clock for deadlines; defaults to `Date.now`. */
  now?: () => number;
  /** Secret values redacted from every emitted event and returned message. */
  secrets?: readonly string[];
}

export interface HarnessRunInput {
  messages: ChatMessage[];
}

/**
 * Configurable LLMBench agent loop. Runs bounded turns of provider completion
 * and tool execution until the model finishes, the run is cancelled or times
 * out, or a configured limit is reached. Secrets never appear in emitted events.
 */
export class LlmBenchHarness {
  readonly #config: HarnessConfig;
  readonly #tools: Map<string, AgentTool>;
  readonly #toolDefinitions: ToolDefinition[];
  readonly #now: () => number;
  readonly #secrets: readonly string[];

  constructor(config: HarnessConfig) {
    this.#config = config;
    this.#tools = new Map(
      (config.tools ?? []).map((tool) => [tool.definition.name, tool]),
    );
    this.#toolDefinitions = (config.tools ?? []).map((tool) => tool.definition);
    this.#now = config.now ?? Date.now;
    this.#secrets = config.secrets ?? [];
  }

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const { limits, model, provider } = this.#config;
    const deadline = this.#now() + limits.maxDurationMs;
    const messages: ChatMessage[] = [];
    if (this.#config.systemPrompt !== undefined) {
      messages.push({ role: "system", content: this.#config.systemPrompt });
    }
    messages.push(...input.messages);

    const events: HarnessEvent[] = [];
    const usage = new UsageAccumulator();
    const controller = new AbortController();
    const timerState: { timedOut: boolean } = { timedOut: false };
    const onAbort = (): void => controller.abort();
    this.#config.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => {
        timerState.timedOut = true;
        controller.abort();
      },
      Math.max(0, deadline - this.#now()),
    );

    let turns = 0;
    let toolCalls = 0;
    let status: HarnessStopReason = "max_turns";
    let error: string | undefined;

    try {
      for (turns = 0; turns < limits.maxTurns; ) {
        const halt = this.#checkHalt(deadline);
        if (halt) {
          status = halt;
          break;
        }
        turns += 1;

        let completion;
        try {
          completion = await provider.complete(
            {
              model,
              messages,
              tools: this.#toolDefinitions,
            },
            { signal: controller.signal },
          );
        } catch (caught) {
          if (isAbortError(caught)) {
            status = timerState.timedOut ? "timeout" : "cancelled";
          } else {
            status = "error";
            error =
              caught instanceof ProviderError ? caught.message : String(caught);
          }
          break;
        }

        usage.add(completion.usage);
        messages.push({
          role: "assistant",
          content: completion.content,
          toolCalls: completion.toolCalls,
        });
        this.#emit(events, {
          type: "assistant",
          content: completion.content,
          toolCallCount: completion.toolCalls.length,
        });

        if (completion.toolCalls.length === 0) {
          status = "completed";
          break;
        }

        const outcome = await this.#runToolCalls(
          completion.toolCalls,
          messages,
          events,
          () => toolCalls,
          () => {
            toolCalls += 1;
          },
          limits,
          controller.signal,
          deadline,
        );
        if (outcome !== null) {
          status = outcome;
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      this.#config.signal?.removeEventListener("abort", onAbort);
    }

    this.#emit(events, { type: "stop", reason: status, detail: error });
    return {
      status,
      messages: messages.map((message) => this.#redactMessage(message)),
      events,
      turns,
      toolCalls,
      usage: usage.value(),
      ...(error !== undefined ? { error: this.#redact(error) } : {}),
    };
  }

  async #runToolCalls(
    calls: ToolCall[],
    messages: ChatMessage[],
    events: HarnessEvent[],
    currentToolCalls: () => number,
    incrementToolCalls: () => void,
    limits: HarnessLimits,
    signal: AbortSignal,
    deadline: number,
  ): Promise<HarnessStopReason | null> {
    for (const call of calls) {
      const halt = this.#checkHalt(deadline);
      if (halt) return halt;
      if (currentToolCalls() >= limits.maxToolCalls) return "max_tool_calls";
      incrementToolCalls();

      this.#emit(events, {
        type: "tool-call",
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });

      const { content, ok } = await this.#executeTool(call, signal);
      messages.push({
        role: "tool",
        content,
        toolCallId: call.id,
        name: call.name,
      });
      this.#emit(events, {
        type: "tool-result",
        id: call.id,
        name: call.name,
        content,
        ok,
      });
    }
    return null;
  }

  async #executeTool(
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<{ content: string; ok: boolean }> {
    const tool = this.#tools.get(call.name);
    if (tool === undefined) {
      return { content: `Unknown tool: ${call.name}`, ok: false };
    }
    try {
      const content = await tool.execute(call.arguments, {
        root: this.#config.root,
        signal,
      });
      return { content, ok: true };
    } catch (caught) {
      return {
        content: caught instanceof Error ? caught.message : String(caught),
        ok: false,
      };
    }
  }

  #checkHalt(deadline: number): HarnessStopReason | null {
    if (this.#config.signal?.aborted) return "cancelled";
    if (this.#now() >= deadline) return "timeout";
    return null;
  }

  #emit(events: HarnessEvent[], event: HarnessEvent): void {
    events.push(this.#redactEvent(event));
  }

  #redactEvent(event: HarnessEvent): HarnessEvent {
    switch (event.type) {
      case "assistant":
        return { ...event, content: this.#redact(event.content) };
      case "tool-call":
        return { ...event, arguments: this.#redact(event.arguments) };
      case "tool-result":
        return { ...event, content: this.#redact(event.content) };
      case "stop":
        return event.detail === undefined
          ? event
          : { ...event, detail: this.#redact(event.detail) };
    }
  }

  #redactMessage(message: ChatMessage): ChatMessage {
    const redacted: ChatMessage = {
      ...message,
      content: this.#redact(message.content),
    };
    if (message.toolCalls !== undefined) {
      redacted.toolCalls = message.toolCalls.map((call) => ({
        ...call,
        arguments: this.#redact(call.arguments),
      }));
    }
    return redacted;
  }

  #redact(text: string): string {
    return redactSecrets(text, this.#secrets);
  }
}

class UsageAccumulator {
  #prompt: number | null = null;
  #completion: number | null = null;
  #total: number | null = null;

  add(usage: Usage): void {
    this.#prompt = accumulate(this.#prompt, usage.promptTokens);
    this.#completion = accumulate(this.#completion, usage.completionTokens);
    this.#total = accumulate(this.#total, usage.totalTokens);
  }

  value(): Usage {
    return {
      promptTokens: this.#prompt,
      completionTokens: this.#completion,
      totalTokens: this.#total,
    };
  }
}

function accumulate(
  current: number | null,
  next: number | null,
): number | null {
  if (next === null) return current;
  return (current ?? 0) + next;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
