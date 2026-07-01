import { describe, expect, it } from "vitest";

import type { CompletionRequest } from "./types";
import { ProviderError } from "./errors";
import {
  buildRequestBody,
  normalizeFinishReason,
  normalizeUsage,
  parseCompletionResponse,
} from "./normalize";

const baseRequest: CompletionRequest = {
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "hi" }],
};

describe("buildRequestBody", () => {
  it("serializes a minimal non-streaming request", () => {
    const body = buildRequestBody(baseRequest, { stream: false });
    expect(body).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
  });

  it("includes optional parameters, tools, and stream options", () => {
    const body = buildRequestBody(
      {
        ...baseRequest,
        temperature: 0.2,
        maxTokens: 128,
        tools: [
          { name: "read", description: "read a file", parameters: { type: "object" } },
        ],
        messages: [
          { role: "system", content: "sys" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "c1", name: "read", arguments: "{}" }],
          },
          { role: "tool", content: "ok", toolCallId: "c1", name: "read" },
        ],
      },
      { stream: true },
    );
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(128);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "read", description: "read a file", parameters: { type: "object" } },
      },
    ]);
    const messages = body.messages as Record<string, unknown>[];
    expect(messages[1]?.tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "read", arguments: "{}" } },
    ]);
    expect(messages[2]).toMatchObject({ tool_call_id: "c1", name: "read" });
  });

  it("omits an empty tools array", () => {
    const body = buildRequestBody({ ...baseRequest, tools: [] }, { stream: false });
    expect(body.tools).toBeUndefined();
  });
});

describe("normalizeFinishReason", () => {
  it("passes through known reasons and defaults unknown ones", () => {
    expect(normalizeFinishReason("stop")).toBe("stop");
    expect(normalizeFinishReason("tool_calls")).toBe("tool_calls");
    expect(normalizeFinishReason("length")).toBe("length");
    expect(normalizeFinishReason("content_filter")).toBe("content_filter");
    expect(normalizeFinishReason("weird")).toBe("unknown");
    expect(normalizeFinishReason(undefined)).toBe("unknown");
  });
});

describe("normalizeUsage", () => {
  it("records missing metadata as null, not zero", () => {
    expect(normalizeUsage(undefined)).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
    expect(normalizeUsage({ prompt_tokens: 5 })).toEqual({
      promptTokens: 5,
      completionTokens: null,
      totalTokens: null,
    });
    expect(normalizeUsage({ prompt_tokens: "x", total_tokens: Infinity })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it("normalizes a complete usage object", () => {
    expect(
      normalizeUsage({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }),
    ).toEqual({ promptTokens: 10, completionTokens: 3, totalTokens: 13 });
  });
});

describe("parseCompletionResponse", () => {
  it("parses content, usage, and model", () => {
    const result = parseCompletionResponse({
      model: "openai/gpt-4o",
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect(result.content).toBe("hello");
    expect(result.finishReason).toBe("stop");
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.usage.totalTokens).toBe(3);
    expect(result.toolCalls).toEqual([]);
  });

  it("parses tool calls and synthesizes missing fields", () => {
    const result = parseCompletionResponse({
      choices: [
        {
          message: {
            tool_calls: [
              { id: "c1", function: { name: "read", arguments: '{"path":"a"}' } },
              { function: {} },
              {},
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(result.model).toBeNull();
    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([
      { id: "c1", name: "read", arguments: '{"path":"a"}' },
      { id: "call_1", name: "", arguments: "" },
      { id: "call_2", name: "", arguments: "" },
    ]);
  });

  it("defaults a missing message and non-array tool_calls", () => {
    const result = parseCompletionResponse({
      choices: [{ finish_reason: "stop" }],
    });
    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([]);
  });

  it("throws a decode error for malformed bodies", () => {
    expect(() => parseCompletionResponse(null)).toThrow(ProviderError);
    expect(() => parseCompletionResponse({})).toThrow(/no choices/);
    expect(() => parseCompletionResponse({ choices: [] })).toThrow(/no choices/);
  });
});
