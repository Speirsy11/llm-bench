import { describe, expect, it } from "vitest";

import type { StreamEvent } from "./types";
import { ProviderError } from "./errors";
import {
  collectStreamContent,
  iterateSseData,
  StreamAssembler,
} from "./stream";

function sseBody(chunks: string): ReadableStream<Uint8Array> {
  return new Response(chunks).body as ReadableStream<Uint8Array>;
}

async function drain(
  stream: ReadableStream<Uint8Array>,
): Promise<StreamEvent[]> {
  const assembler = new StreamAssembler();
  const events: StreamEvent[] = [];
  for await (const data of iterateSseData(stream)) {
    events.push(...assembler.push(data));
  }
  events.push(...assembler.finish());
  return events;
}

describe("StreamAssembler", () => {
  it("emits content live and assembles tool calls at the end", async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n` +
      `data: {"choices":[{"delta":{"content":"lo"}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"re"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"p\\":1}"}}]},"finish_reason":"tool_calls"}]}\n\n` +
      `data: {"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n` +
      `data: [DONE]\n\n`;
    const events = await drain(sseBody(body));

    const collected = collectStreamContent(events);
    expect(collected.content).toBe("Hello");
    expect(collected.toolCalls).toEqual([
      { id: "c1", name: "re", arguments: '{"p":1}' },
    ]);
    expect(collected.usage.totalTokens).toBe(6);
    expect(collected.finishReason).toBe("tool_calls");
  });

  it("assembles a tool call whose index is omitted", () => {
    const assembler = new StreamAssembler();
    assembler.push(
      JSON.stringify({
        choices: [
          { delta: { tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] } },
        ],
      }),
    );
    const events = assembler.finish();
    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "c1", name: "f", arguments: "{}" },
    });
  });

  it("finishes at EOF without a [DONE] marker and is idempotent", () => {
    const assembler = new StreamAssembler();
    assembler.push(JSON.stringify({ choices: [{ delta: {} }] }));
    const first = assembler.finish();
    expect(first.at(-1)).toEqual({ type: "done", finishReason: "unknown" });
    expect(assembler.finish()).toEqual([]);
  });

  it("ignores empty deltas and non-array tool calls", () => {
    const assembler = new StreamAssembler();
    const events = assembler.push(
      JSON.stringify({ choices: [{ delta: { content: "", tool_calls: "nope" } }] }),
    );
    expect(events).toEqual([]);
  });

  it("tolerates a choice with no delta and a tool call with no function", () => {
    const assembler = new StreamAssembler();
    expect(assembler.push(JSON.stringify({ choices: [{ finish_reason: "stop" }] }))).toEqual(
      [],
    );
    assembler.push(
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1" }] } }] }),
    );
    expect(assembler.finish()[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "c1", name: "", arguments: "" },
    });
  });

  it("records an explicit null usage as unknown", () => {
    const assembler = new StreamAssembler();
    assembler.push(JSON.stringify({ usage: null, choices: [{ delta: {} }] }));
    const events = assembler.finish();
    expect(events).toContainEqual({
      type: "usage",
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
    });
  });

  it("throws a decode error on malformed chunks", () => {
    const assembler = new StreamAssembler();
    expect(() => assembler.push("{not json")).toThrow(ProviderError);
  });
});

describe("iterateSseData", () => {
  it("reassembles events split across byte-chunk boundaries", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"con'));
        controller.enqueue(encoder.encode('tent":"hi"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const events = await drain(stream);
    expect(collectStreamContent(events).content).toBe("hi");
  });

  it("skips comment/heartbeat lines and flushes a trailing event", async () => {
    const body =
      `: keep-alive\n\n` +
      `data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}`;
    const events = await drain(sseBody(body));
    expect(collectStreamContent(events).content).toBe("x");
    expect(collectStreamContent(events).finishReason).toBe("stop");
  });
});
