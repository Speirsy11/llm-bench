import { describe, expect, it, vi } from "vitest";

import type { CompletionRequest } from "./types";
import { ProviderError } from "./errors";
import { OpenAICompatibleProvider } from "./provider";
import { collectStreamContent } from "./stream";

const request: CompletionRequest = {
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "hi" }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenAICompatibleProvider.complete", () => {
  it("posts to the chat-completions endpoint and normalizes the result", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          model: "openai/gpt-4o",
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1/",
      apiKey: { reveal: () => "sk-secret-canary" },
      fetch: fetchMock,
    });

    const result = await provider.complete(request);
    expect(result.content).toBe("hello");

    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-secret-canary");
    expect(init.body).not.toContain("canary");
  });

  it("normalizes slash-heavy provider URLs without pathological backtracking", async () => {
    const slashHeavyBaseUrl = `https://example.test/${"/".repeat(50_000)}v1`;
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
      ),
    );

    const startedAt = performance.now();
    const provider = new OpenAICompatibleProvider({
      baseUrl: slashHeavyBaseUrl,
      apiKey: "sk",
      fetch: fetchMock,
    });
    await provider.complete(request);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(fetchMock).toHaveBeenCalledWith(
      `${slashHeavyBaseUrl}/chat/completions`,
      expect.any(Object),
    );
  });

  it("accepts a plain string api key", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-plain",
      fetch: fetchMock,
    });
    await provider.complete(request);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const init2 = (call as unknown as [string, RequestInit])[1];
    const headers = init2.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-plain");
  });

  it("maps non-2xx responses to provider errors", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "nope" } }), {
            status: 429,
          }),
        ),
    });
    await expect(provider.complete(request)).rejects.toMatchObject({
      type: "rate_limit",
      retryable: true,
    });
  });

  it("raises a decode error on invalid JSON", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: () => Promise.resolve(new Response("<html>", { status: 200 })),
    });
    await expect(provider.complete(request)).rejects.toMatchObject({
      type: "decode",
    });
  });

  it("wraps transport failures as retryable network errors", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: (): Promise<Response> => {
        throw new TypeError("connection refused");
      },
    });
    const error = await provider.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ type: "network", retryable: true });
  });

  it("propagates abort as-is", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: (): Promise<Response> => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(provider.complete(request)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("propagates a plain AbortError", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: (): Promise<Response> => {
        throw abortError;
      },
    });
    await expect(provider.complete(request)).rejects.toBe(abortError);
  });

  it("uses the global fetch when none is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "g" }, finish_reason: "stop" }],
      }),
    );
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
    });
    const result = await provider.complete(request);
    expect(result.content).toBe("g");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("OpenAICompatibleProvider.stream", () => {
  it("streams normalized events", async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n` +
      `data: [DONE]\n\n`;
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    });
    const events = [];
    for await (const event of provider.stream(request)) events.push(event);
    expect(collectStreamContent(events).content).toBe("hi");
  });

  it("maps a streaming error status", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: () => Promise.resolve(new Response("boom", { status: 500 })),
    });
    await expect(async () => {
      for await (const _event of provider.stream(request)) void _event;
    }).rejects.toMatchObject({ type: "server_error" });
  });

  it("rejects a streaming response with no body", async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk",
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
    });
    await expect(async () => {
      for await (const _event of provider.stream(request)) void _event;
    }).rejects.toMatchObject({ type: "decode" });
  });
});
