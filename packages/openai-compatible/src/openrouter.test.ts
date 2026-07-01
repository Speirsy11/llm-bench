import { describe, expect, it, vi } from "vitest";

import { OPENROUTER_BASE_URL, OpenRouterProvider } from "./openrouter";

const request = {
  model: "anthropic/claude-3.5-sonnet",
  messages: [{ role: "user" as const, content: "hi" }],
};

function okResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OpenRouterProvider", () => {
  it("targets the OpenRouter gateway and sends attribution headers", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const provider = new OpenRouterProvider({
      apiKey: "sk-or-key",
      fetch: fetchMock,
      referer: "https://llmbench.dev",
      title: "LLMBench",
    });
    await provider.complete(request);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    const headers = init.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBe("https://llmbench.dev");
    expect(headers["X-Title"]).toBe("LLMBench");
    expect(headers.authorization).toBe("Bearer sk-or-key");
  });

  it("omits attribution headers when not provided and allows a base url override", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const provider = new OpenRouterProvider({
      apiKey: "sk-or-key",
      fetch: fetchMock,
      baseUrl: "https://proxy.test/v1",
    });
    await provider.complete(request);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://proxy.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
  });
});
