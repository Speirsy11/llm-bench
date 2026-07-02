/**
 * Provider-neutral chat vocabulary for OpenAI-compatible endpoints. These types
 * are the normalized surface the harness works against; wire-format quirks are
 * absorbed by the provider implementation.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments string as emitted by the model. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Populated on assistant turns that request tool execution. */
  toolCalls?: ToolCall[];
  /** Populated on `tool` messages to correlate the originating call. */
  toolCallId?: string;
  /** Optional tool name echoed back on tool result messages. */
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Token accounting. Missing provider metadata is represented as `null` rather
 * than `0`, so downstream metrics never conflate "unknown" with "none".
 */
export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "unknown";

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  model: string | null;
}

/** Streaming events emitted while a completion is produced. */
export type StreamEvent =
  | { type: "content"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: FinishReason };

export type ProviderErrorType =
  | "authentication"
  | "rate_limit"
  | "invalid_request"
  | "server_error"
  | "network"
  | "decode";

/** Minimal structural view of a secret; satisfied by `@llm-bench/crypto`'s `Secret`. */
export interface RevealableSecret {
  reveal(): string;
}

export type ApiKey = string | RevealableSecret;
