import type { FetchLike } from "./provider";
import type { ApiKey } from "./types";
import { OpenAICompatibleProvider } from "./provider";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;

export interface OpenRouterProviderConfig {
  apiKey: ApiKey;
  fetch?: FetchLike;
  /** Optional override for self-hosted or proxy gateways. */
  baseUrl?: string;
  /** Attribution headers OpenRouter uses for app ranking. */
  referer?: string;
  title?: string;
}

/**
 * OpenRouter provider. A thin specialisation of the OpenAI-compatible transport
 * that targets OpenRouter's gateway and adds its attribution headers.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config: OpenRouterProviderConfig) {
    const defaultHeaders: Record<string, string> = {};
    if (config.referer !== undefined)
      defaultHeaders["HTTP-Referer"] = config.referer;
    if (config.title !== undefined) defaultHeaders["X-Title"] = config.title;
    super({
      baseUrl: config.baseUrl ?? OPENROUTER_BASE_URL,
      apiKey: config.apiKey,
      fetch: config.fetch,
      defaultHeaders,
    });
  }
}
