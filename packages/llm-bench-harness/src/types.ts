import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ToolDefinition,
  Usage,
} from "@llm-bench/openai-compatible";

/** Minimal provider surface the harness drives; satisfied by the OpenRouter provider. */
export interface HarnessProvider {
  complete(
    request: CompletionRequest,
    options: { signal?: AbortSignal },
  ): Promise<CompletionResult>;
}

/** Context handed to a tool on each invocation. */
export interface ToolContext {
  /** Repository root the tool must stay within. */
  root: string;
  /** Cancels the tool when the run is aborted or times out. */
  signal: AbortSignal;
}

/** An executable tool exposed to the model. */
export interface AgentTool {
  definition: ToolDefinition;
  execute(rawArguments: string, context: ToolContext): Promise<string>;
}

/** Bounds that force the loop to terminate. */
export interface HarnessLimits {
  maxTurns: number;
  maxToolCalls: number;
  maxDurationMs: number;
}

export type HarnessStopReason =
  | "completed"
  | "cancelled"
  | "timeout"
  | "max_turns"
  | "max_tool_calls"
  | "error";

export type HarnessEvent =
  | { type: "assistant"; content: string; toolCallCount: number }
  | { type: "tool-call"; id: string; name: string; arguments: string }
  | { type: "tool-result"; id: string; name: string; content: string; ok: boolean }
  | { type: "stop"; reason: HarnessStopReason; detail?: string };

export interface HarnessRunResult {
  status: HarnessStopReason;
  messages: ChatMessage[];
  events: HarnessEvent[];
  turns: number;
  toolCalls: number;
  usage: Usage;
  /** Present when `status` is `error`. */
  error?: string;
}
