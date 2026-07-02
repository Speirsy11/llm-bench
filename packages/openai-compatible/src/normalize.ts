import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  FinishReason,
  ToolCall,
  Usage,
} from "./types";
import { ProviderError } from "./errors";

const USAGE_UNKNOWN: Usage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
};

/** Builds the OpenAI chat-completions request body from a normalized request. */
export function buildRequestBody(
  request: CompletionRequest,
  options: { stream: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(serializeMessage),
    stream: options.stream,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  if (options.stream) {
    body.stream_options = { include_usage: true };
  }
  return body;
}

function serializeMessage(message: ChatMessage): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCallId !== undefined) {
    serialized.tool_call_id = message.toolCallId;
  }
  if (message.name !== undefined) serialized.name = message.name;
  if (message.toolCalls && message.toolCalls.length > 0) {
    serialized.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return serialized;
}

/** Maps a raw finish reason string to the normalized enum. */
export function normalizeFinishReason(raw: unknown): FinishReason {
  switch (raw) {
    case "stop":
    case "length":
    case "tool_calls":
    case "content_filter":
      return raw;
    default:
      return "unknown";
  }
}

/**
 * Normalizes a usage object. Absent or non-numeric fields become `null` so that
 * missing metadata is recorded explicitly rather than as a real zero count.
 */
export function normalizeUsage(raw: unknown): Usage {
  if (typeof raw !== "object" || raw === null) return { ...USAGE_UNKNOWN };
  const usage = raw as Record<string, unknown>;
  return {
    promptTokens: numberOrNull(usage.prompt_tokens),
    completionTokens: numberOrNull(usage.completion_tokens),
    totalTokens: numberOrNull(usage.total_tokens),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface RawToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/** Parses a non-streaming chat-completions response into a normalized result. */
export function parseCompletionResponse(raw: unknown): CompletionResult {
  if (typeof raw !== "object" || raw === null) {
    throw new ProviderError(
      "Provider returned a non-object body.",
      "decode",
      false,
    );
  }
  const body = raw as Record<string, unknown>;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError(
      "Provider response had no choices.",
      "decode",
      false,
    );
  }
  const choice = choices[0] as Record<string, unknown>;
  const message = (choice.message ?? {}) as Record<string, unknown>;

  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls: parseToolCalls(message.tool_calls),
    finishReason: normalizeFinishReason(choice.finish_reason),
    usage: normalizeUsage(body.usage),
    model: typeof body.model === "string" ? body.model : null,
  };
}

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  raw.forEach((entry, index) => {
    const call = entry as RawToolCall;
    const fn = call.function ?? {};
    calls.push({
      id: typeof call.id === "string" ? call.id : `call_${index}`,
      name: typeof fn.name === "string" ? fn.name : "",
      arguments: typeof fn.arguments === "string" ? fn.arguments : "",
    });
  });
  return calls;
}
