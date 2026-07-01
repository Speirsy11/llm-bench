import type {
  ApiKey,
  CompletionRequest,
  CompletionResult,
  StreamEvent,
} from "./types";
import { errorFromResponse, ProviderError } from "./errors";
import { buildRequestBody, parseCompletionResponse } from "./normalize";
import { iterateSseData, StreamAssembler } from "./stream";

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface ProviderConfig {
  /** Base URL including version, e.g. `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey: ApiKey;
  /** Injectable fetch implementation; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Extra headers merged into every request (e.g. attribution headers). */
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Transport for any OpenAI-compatible `/chat/completions` endpoint. Credentials
 * are read only here, at the provider boundary, and never logged.
 */
export class OpenAICompatibleProvider {
  readonly #baseUrl: string;
  readonly #apiKey: ApiKey;
  readonly #fetch: FetchLike;
  readonly #defaultHeaders: Record<string, string>;

  constructor(config: ProviderConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetch ?? ((input, init) => fetch(input, init));
    this.#defaultHeaders = config.defaultHeaders ?? {};
  }

  async complete(
    request: CompletionRequest,
    options: RequestOptions = {},
  ): Promise<CompletionResult> {
    const response = await this.#send(request, false, options.signal);
    const text = await response.text();
    if (!response.ok) throw errorFromResponse(response.status, text);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      throw new ProviderError("Provider returned invalid JSON.", "decode", false, response.status, { cause });
    }
    return parseCompletionResponse(json);
  }

  async *stream(
    request: CompletionRequest,
    options: RequestOptions = {},
  ): AsyncGenerator<StreamEvent> {
    const response = await this.#send(request, true, options.signal);
    if (!response.ok) {
      throw errorFromResponse(response.status, await response.text());
    }
    if (response.body === null) {
      throw new ProviderError("Provider stream had no body.", "decode", false, response.status);
    }
    const assembler = new StreamAssembler();
    for await (const data of iterateSseData(response.body)) {
      yield* assembler.push(data);
    }
    yield* assembler.finish();
  }

  async #send(
    request: CompletionRequest,
    stream: boolean,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const body = JSON.stringify(buildRequestBody(request, { stream }));
    try {
      return await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolveApiKey(this.#apiKey)}`,
          ...this.#defaultHeaders,
        },
        body,
        signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      if (cause instanceof Error && cause.name === "AbortError") throw cause;
      throw new ProviderError("Provider request failed to reach the network.", "network", true, null, { cause });
    }
  }
}

function resolveApiKey(apiKey: ApiKey): string {
  return typeof apiKey === "string" ? apiKey : apiKey.reveal();
}
