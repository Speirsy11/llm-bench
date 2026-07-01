import type { FinishReason, StreamEvent, ToolCall, Usage } from "./types";
import { ProviderError } from "./errors";
import { normalizeFinishReason, normalizeUsage } from "./normalize";

const UNKNOWN_USAGE: Usage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
};

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Assembles OpenAI streaming chunks into normalized {@link StreamEvent}s.
 * Content is emitted live; tool calls, usage, and the final finish reason are
 * emitted once the stream terminates (either a `[DONE]` marker or EOF).
 */
export class StreamAssembler {
  readonly #toolCalls = new Map<number, PartialToolCall>();
  #finishReason: FinishReason = "unknown";
  #usage: Usage | null = null;
  #finished = false;

  push(data: string): StreamEvent[] {
    if (data === "[DONE]") return this.finish();

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data) as Record<string, unknown>;
    } catch (cause) {
      throw new ProviderError("Malformed stream chunk.", "decode", false, null, {
        cause,
      });
    }

    const events: StreamEvent[] = [];
    if (chunk.usage !== undefined && chunk.usage !== null) {
      this.#usage = normalizeUsage(chunk.usage);
    }

    const choices = chunk.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as Record<string, unknown>;
      const delta = (choice.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        events.push({ type: "content", delta: delta.content });
      }
      this.#accumulateToolCalls(delta.tool_calls);
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        this.#finishReason = normalizeFinishReason(choice.finish_reason);
      }
    }
    return events;
  }

  finish(): StreamEvent[] {
    if (this.#finished) return [];
    this.#finished = true;
    const events: StreamEvent[] = [];
    for (const [, call] of [...this.#toolCalls.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      events.push({ type: "tool-call", toolCall: { ...call } });
    }
    events.push({ type: "usage", usage: this.#usage ?? { ...UNKNOWN_USAGE } });
    events.push({ type: "done", finishReason: this.#finishReason });
    return events;
  }

  #accumulateToolCalls(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    raw.forEach((entry, position) => {
      const item = entry as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const index = typeof item.index === "number" ? item.index : position;
      const existing =
        this.#toolCalls.get(index) ??
        ({ id: `call_${index}`, name: "", arguments: "" } satisfies PartialToolCall);
      if (typeof item.id === "string") existing.id = item.id;
      const fn = item.function ?? {};
      if (typeof fn.name === "string") existing.name += fn.name;
      if (typeof fn.arguments === "string") existing.arguments += fn.arguments;
      this.#toolCalls.set(index, existing);
    });
  }
}

/**
 * Iterates a byte stream of Server-Sent Events, yielding each `data:` payload.
 * Handles chunk boundaries that split individual events.
 */
export async function* iterateSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractData(rawEvent);
        if (data !== null) yield data;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  const tail = extractData(buffer);
  if (tail !== null) yield tail;
}

function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.startsWith("data:") ? line.slice(5).trimStart() : null;
    if (trimmed !== null) dataLines.push(trimmed);
  }
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

/**
 * Reduces a stream of normalized events into a single result-like accumulation
 * of content and tool calls. Used by non-streaming callers of the stream API.
 */
export function collectStreamContent(events: StreamEvent[]): {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: FinishReason;
} {
  let content = "";
  const toolCalls: ToolCall[] = [];
  let usage: Usage = { ...UNKNOWN_USAGE };
  let finishReason: FinishReason = "unknown";
  for (const event of events) {
    if (event.type === "content") content += event.delta;
    else if (event.type === "tool-call") toolCalls.push(event.toolCall);
    else if (event.type === "usage") usage = event.usage;
    else finishReason = event.finishReason;
  }
  return { content, toolCalls, usage, finishReason };
}
