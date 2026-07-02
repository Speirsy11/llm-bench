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

import type { CodexEvent } from "./events";
import type { CodexRunRequest, CodexRunResult } from "./types";
import { CodexEventSchema } from "./events";

const defaultManifest: HarnessManifest = {
  id: "codex",
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

export class CodexHarness extends JsonlProcessHarnessAdapter<CodexEvent> {
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
      threadIdFrom(checkpoint) !== null
    );
  }

  async probe(): Promise<{ available: boolean; version: string | null }> {
    try {
      const result = await (this.options.runner ?? new NodeProcessRunner()).run(
        {
          argv: [this.options.binary ?? "codex", "--version"],
          cwd: process.cwd(),
          env: cleanProcessEnvironment(process.env, this.options.env),
          signal: AbortSignal.timeout(5_000),
          maxOutputBytes: 16 * 1024,
          redact: this.options.redact,
        },
      );
      if (result.exitCode !== 0) return { available: false, version: null };
      const match = /^codex-cli\s+(\S+)$/u.exec(result.stdoutLines[0] ?? "");
      this.version = match?.[1] ?? null;
      return { available: true, version: this.version };
    } catch {
      return { available: false, version: null };
    }
  }

  protected override parseEvent(line: string): CodexEvent {
    return CodexEventSchema.parse(JSON.parse(line) as unknown);
  }

  protected override complete(
    request: CodexRunRequest,
    events: CodexEvent[],
    processResult: ProcessRunResult,
  ): CodexRunResult {
    const sandbox =
      request.mode === "agentic" ? "workspace-write" : "read-only";
    const failed = events.find(
      (event) => event.type === "turn.failed" || event.type === "error",
    );
    if (processResult.cancelled) {
      return this.result(request, sandbox, events, "cancelled");
    }
    if (processResult.exitCode !== 0 || failed) {
      const error = failed
        ? describeFailure(failed)
        : new ProcessExitError(
            processResult.exitCode,
            processResult.signal,
            processResult.stderr,
          ).message;
      return this.result(request, sandbox, events, "failed", error);
    }
    return this.result(request, sandbox, events, "completed");
  }

  override command(request: CodexRunRequest): [string, ...string[]] {
    const binary = this.options.binary ?? "codex";
    const common = [
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "--model",
      request.modelRouteId,
    ];
    const threadId = threadIdFrom(request.checkpoint);
    if (threadId) {
      return [binary, "exec", "resume", ...common, threadId, "-"];
    }
    const sandbox =
      request.mode === "agentic" ? "workspace-write" : "read-only";
    return [
      binary,
      "exec",
      ...common,
      "--sandbox",
      sandbox,
      "--cd",
      request.workspaceRoot,
      ...(this.options.ephemeral ? ["--ephemeral"] : []),
      "-",
    ];
  }

  private result(
    request: CodexRunRequest,
    sandbox: "read-only" | "workspace-write",
    events: CodexEvent[],
    status: CodexRunResult["status"],
    error?: string,
  ): CodexRunResult {
    const thread = events.find((event) => event.type === "thread.started");
    const completion = [...events]
      .reverse()
      .find((event) => event.type === "turn.completed");
    let output = "";
    for (const event of events) {
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        output = typeof event.item.text === "string" ? event.item.text : "";
      }
    }
    const effectiveThreadId =
      thread?.thread_id ?? threadIdFrom(request.checkpoint);
    const checkpoint = this.options.ephemeral
      ? null
      : effectiveThreadId && status === "completed"
        ? {
            jobId: request.jobId,
            sequence:
              request.checkpoint === null ? 0 : request.checkpoint.sequence + 1,
            resumable: true,
            state: { threadId: effectiveThreadId },
          }
        : request.checkpoint;
    const observations = completion
      ? [
          { metricId: "input_tokens", value: completion.usage.input_tokens },
          {
            metricId: "cached_input_tokens",
            value: completion.usage.cached_input_tokens,
          },
          { metricId: "output_tokens", value: completion.usage.output_tokens },
          {
            metricId: "reasoning_output_tokens",
            value: completion.usage.reasoning_output_tokens,
          },
        ]
      : [];
    return {
      status,
      output,
      observations,
      checkpoint,
      events,
      metadata: {
        harness: "codex",
        model: request.modelRouteId,
        sandbox,
        version: this.version,
      },
      ...(error === undefined ? {} : { error }),
    };
  }
}

function threadIdFrom(checkpoint: Checkpoint | null): string | null {
  const threadId = checkpoint?.state.threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

function describeFailure(
  event: Extract<CodexEvent, { type: "error" | "turn.failed" }>,
): string {
  if (event.type === "error") return event.message;
  if (typeof event.error === "string") return event.error;
  if (event.error === undefined) return "Codex reported a failed turn.";
  return `Codex reported a failed turn: ${JSON.stringify(event.error)}`;
}
