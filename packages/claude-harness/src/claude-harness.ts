import type { Checkpoint, HarnessManifest } from "@llm-bench/contracts";
import type {
  ProcessRunner,
  ProcessRunResult,
} from "@llm-bench/process-harness";
import {
  cleanProcessEnvironment,
  JsonlProcessHarnessAdapter,
  NodeProcessRunner,
  ProcessExitError,
} from "@llm-bench/process-harness";

import type { ClaudeEvent } from "./events";
import type { ClaudeRunRequest, ClaudeRunResult } from "./types";
import { ClaudeEventSchema } from "./events";

const defaultManifest: HarnessManifest = {
  id: "claude",
  version: "unknown",
  capabilities: [
    "response_generation",
    "workspaces",
    "files",
    "shell",
    "streaming",
    "session_resume",
    "usage_reporting",
  ],
  modelRoutes: [],
};

export class ClaudeHarness extends JsonlProcessHarnessAdapter<ClaudeEvent> {
  private version: string | null = null;

  constructor(
    private readonly options: {
      binary?: string;
      runner?: ProcessRunner;
      env?: NodeJS.ProcessEnv;
      maxOutputBytes?: number;
      redact?: readonly string[];
      ephemeral?: boolean;
      manifest?: HarnessManifest;
    } = {},
  ) {
    super(options.manifest ?? defaultManifest, {
      runner: options.runner,
      env: options.env,
      maxOutputBytes: options.maxOutputBytes,
      redact: options.redact,
    });
  }

  override canResume(checkpoint: Checkpoint | null): boolean {
    return (
      this.options.ephemeral !== true &&
      super.canResume(checkpoint) &&
      sessionIdFrom(checkpoint) !== null
    );
  }

  async probe(): Promise<{ available: boolean; version: string | null }> {
    try {
      const result = await (this.options.runner ?? new NodeProcessRunner()).run(
        {
          argv: [this.options.binary ?? "claude", "--version"],
          cwd: process.cwd(),
          env: cleanProcessEnvironment(process.env, this.options.env),
          signal: AbortSignal.timeout(5_000),
          maxOutputBytes: 16 * 1024,
          redact: this.options.redact,
        },
      );
      if (result.exitCode !== 0) return { available: false, version: null };
      // Claude Code version output: "2.1.198 (Claude Code)"
      const match = /^(\S+)\s/u.exec(result.stdoutLines[0] ?? "");
      this.version = match?.[1] ?? null;
      return { available: true, version: this.version };
    } catch {
      return { available: false, version: null };
    }
  }

  protected override parseEvent(line: string): ClaudeEvent {
    return ClaudeEventSchema.parse(JSON.parse(line) as unknown);
  }

  protected override complete(
    request: ClaudeRunRequest,
    events: ClaudeEvent[],
    processResult: ProcessRunResult,
  ): ClaudeRunResult {
    const sandbox =
      request.mode === "agentic" ? "workspace-write" : "read-only";
    const failed = events.find((event) => event.type === "error");
    if (processResult.cancelled) {
      return this.result(request, sandbox, events, "cancelled");
    }
    if (processResult.exitCode !== 0 || failed) {
      const error = failed
        ? failed.message
        : new ProcessExitError(
            processResult.exitCode,
            processResult.signal,
            processResult.stderr,
          ).message;
      return this.result(request, sandbox, events, "failed", error);
    }
    return this.result(request, sandbox, events, "completed");
  }

  override command(request: ClaudeRunRequest): [string, ...string[]] {
    this.validateRequest(request);
    const binary = this.options.binary ?? "claude";
    const common = ["--print", "--model", request.modelRouteId];
    const sessionId = sessionIdFrom(request.checkpoint);
    if (sessionId) {
      return [binary, "resume", ...common, "--session-id", sessionId];
    }
    const sandbox =
      request.mode === "agentic" ? "workspace-write" : "read-only";
    return [
      binary,
      ...common,
      "--sandbox",
      sandbox,
      "--cd",
      request.workspaceRoot,
      ...(this.options.ephemeral ? ["--ephemeral"] : []),
      "--output-format",
      "stream-json",
      "-",
    ];
  }

  private validateRequest(request: ClaudeRunRequest): void {
    if (request.toolset.tools.length > 0) {
      throw new Error(
        "ClaudeHarness does not support runner-managed tools yet.",
      );
    }
    if (request.toolset.mcpProfiles.length > 0) {
      throw new Error("ClaudeHarness does not support MCP profiles yet.");
    }
    if (request.checkpoint !== null && !this.canResume(request.checkpoint)) {
      throw new Error(
        "ClaudeHarness cannot resume from the supplied checkpoint.",
      );
    }
  }

  private result(
    request: ClaudeRunRequest,
    sandbox: "read-only" | "workspace-write",
    events: ClaudeEvent[],
    status: ClaudeRunResult["status"],
    error?: string,
  ): ClaudeRunResult {
    // Extract the final assistant message text
    const assistantEvents = events.filter((e) => e.type === "assistant");
    const lastAssistant = assistantEvents[assistantEvents.length - 1];
    let output = "";
    if (lastAssistant?.message.content) {
      for (const block of lastAssistant.message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          output += block.text;
        }
      }
    }

    // Extract usage from the last assistant message
    const usageEvent = lastAssistant;
    const observations = usageEvent?.message.usage
      ? [
          {
            metricId: "input_tokens",
            value: usageEvent.message.usage.input_tokens,
          },
          {
            metricId: "cached_input_tokens",
            value:
              (usageEvent.message.usage.cache_creation_input_tokens ?? 0) +
              (usageEvent.message.usage.cache_read_input_tokens ?? 0),
          },
          {
            metricId: "output_tokens",
            value: usageEvent.message.usage.output_tokens,
          },
        ]
      : [];

    // Find the latest session_id for resumption
    const effectiveSessionId =
      findSessionId(events) ?? sessionIdFrom(request.checkpoint);
    const checkpoint = this.options.ephemeral
      ? null
      : effectiveSessionId && status === "completed"
        ? {
            jobId: request.jobId,
            sequence:
              request.checkpoint === null ? 0 : request.checkpoint.sequence + 1,
            resumable: true,
            state: { sessionId: effectiveSessionId },
          }
        : request.checkpoint;

    return {
      status,
      output,
      observations,
      checkpoint,
      events,
      metadata: {
        harness: "claude",
        model: request.modelRouteId,
        sandbox,
        version: this.version,
      },
      ...(error === undefined ? {} : { error }),
    };
  }
}

function sessionIdFrom(checkpoint: Checkpoint | null): string | null {
  const sessionId = checkpoint?.state.sessionId;
  return typeof sessionId === "string" && sessionId.length > 0
    ? sessionId
    : null;
}

function findSessionId(events: ClaudeEvent[]): string | null {
  for (const event of events) {
    if ("session_id" in event && typeof event.session_id === "string") {
      return event.session_id;
    }
  }
  return null;
}
