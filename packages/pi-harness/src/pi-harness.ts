import type { HarnessManifest, MetricObservation } from "@llm-bench/contracts";
import type {
  ProcessRunner,
  ProcessRunResult,
} from "@llm-bench/process-harness";
import { ProcessHarnessAdapter } from "@llm-bench/contracts";
import {
  cleanProcessEnvironment,
  NodeProcessRunner,
  ProcessExitError,
  runProcessHarnessCommand,
} from "@llm-bench/process-harness";

import type { PiEvent } from "./events";
import type { PiRunRequest, PiRunResult } from "./types";
import { parsePiLine } from "./events";

const defaultManifest: HarnessManifest = {
  id: "pi",
  version: "unknown",
  capabilities: [
    "response_generation",
    "shell",
    "streaming",
    "usage_reporting",
  ],
  modelRoutes: [],
};

export class PiHarness extends ProcessHarnessAdapter {
  private version: string | null = null;

  constructor(
    private readonly options: {
      binary?: string;
      runner?: ProcessRunner;
      env?: NodeJS.ProcessEnv;
      maxOutputBytes?: number;
      redact?: readonly string[];
      manifest?: HarnessManifest;
    } = {},
  ) {
    super(options.manifest ?? defaultManifest);
  }

  async probe(): Promise<{ available: boolean; version: string | null }> {
    try {
      const result = await (this.options.runner ?? new NodeProcessRunner()).run(
        {
          argv: [this.options.binary ?? "pi", "--version"],
          cwd: process.cwd(),
          env: cleanProcessEnvironment(process.env, this.options.env),
          signal: AbortSignal.timeout(5_000),
          maxOutputBytes: 16 * 1024,
          redact: this.options.redact,
        },
      );
      if (result.exitCode !== 0) return { available: false, version: null };
      const match = /^(\S+)/u.exec(result.stdoutLines[0] ?? "");
      this.version = match?.[1] ?? null;
      return { available: true, version: this.version };
    } catch {
      return { available: false, version: null };
    }
  }

  override async run(request: PiRunRequest): Promise<PiRunResult> {
    const processResult = await runProcessHarnessCommand(
      request,
      this.command(request),
      {
        runner: this.options.runner,
        env: this.options.env,
        maxOutputBytes: this.options.maxOutputBytes,
        redact: this.options.redact,
        stdin: this.formatStdin(request),
      },
    );

    const events = processResult.stdoutLines.map((line, index) => {
      try {
        return parsePiLine(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON-RPC message at line ${index + 1}: ${String(error)}`,
        );
      }
    });

    return this.complete(request, events, processResult);
  }

  override command(request: PiRunRequest): [string, ...string[]] {
    this.validateRequest(request);
    return [
      this.options.binary ?? "pi",
      "--headless",
      "--model",
      request.modelRouteId,
    ];
  }

  private validateRequest(request: PiRunRequest): void {
    if (request.mode !== "response") {
      throw new Error("PiHarness only supports response mode.");
    }
    if (request.checkpoint !== null) {
      throw new Error("PiHarness does not support session resume.");
    }
    if (request.toolset.tools.length > 0) {
      throw new Error("PiHarness does not support runner-managed tools yet.");
    }
    if (request.toolset.mcpProfiles.length > 0) {
      throw new Error("PiHarness does not support MCP profiles yet.");
    }
  }

  private formatStdin(request: PiRunRequest): string {
    const messages: string[] = [];
    let id = 0;

    // Initialize
    messages.push(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "llm-bench", version: "1.0.0" },
        },
        id: ++id,
      }),
    );

    // Send the prompt via a user message / tools call
    messages.push(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "conversation/send",
        params: { message: request.prompt },
        id: ++id,
      }),
    );

    return messages.join("\n") + "\n";
  }

  private complete(
    request: PiRunRequest,
    events: PiEvent[],
    processResult: ProcessRunResult,
  ): PiRunResult {
    if (processResult.cancelled) {
      return this.result(request, events, "cancelled");
    }

    const errors = events.filter(
      (e) =>
        e._kind === "response" &&
        (e as { error?: unknown }).error !== undefined,
    );
    if (processResult.exitCode !== 0 || errors.length > 0) {
      const errorMessage =
        errors.length > 0
          ? (errors[0] as { error: { message: string } }).error.message
          : new ProcessExitError(
              processResult.exitCode,
              processResult.signal,
              processResult.stderr,
            ).message;
      return this.result(request, events, "failed", errorMessage);
    }

    return this.result(request, events, "completed");
  }

  private result(
    request: PiRunRequest,
    events: PiEvent[],
    status: PiRunResult["status"],
    error?: string,
  ): PiRunResult {
    // Extract output from the conversation response
    let output = "";
    for (const event of events) {
      if (
        event._kind === "response" &&
        event.result &&
        typeof event.result === "object"
      ) {
        const result = event.result as Record<string, unknown>;
        if (typeof result.text === "string") output = result.text;
        if (typeof result.content === "string") output = result.content;
        if (
          Array.isArray(result.content) &&
          result.content.length > 0 &&
          typeof result.content[0] === "object" &&
          result.content[0] !== null
        ) {
          const block = result.content[0] as Record<string, unknown>;
          if (typeof block.text === "string") output = block.text;
        }
      }
    }

    return {
      status,
      output,
      observations: usageObservations(events),
      checkpoint: request.checkpoint,
      events,
      metadata: {
        harness: "pi",
        model: request.modelRouteId,
        version: this.version,
      },
      ...(error === undefined ? {} : { error }),
    };
  }
}

function usageObservations(events: PiEvent[]): MetricObservation[] {
  const observations: MetricObservation[] = [];
  const usage = latestUsage(events);
  if (usage === null) return observations;

  pushObservation(observations, "input_tokens", usage.input_tokens);
  pushObservation(
    observations,
    "cached_input_tokens",
    usage.cached_input_tokens,
  );
  pushObservation(observations, "output_tokens", usage.output_tokens);
  return observations;
}

function latestUsage(events: PiEvent[]): Record<string, unknown> | null {
  for (const event of [...events].reverse()) {
    if (
      event._kind === "response" &&
      event.result &&
      typeof event.result === "object"
    ) {
      const usage = (event.result as Record<string, unknown>).usage;
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        return usage as Record<string, unknown>;
      }
    }
  }
  return null;
}

function pushObservation(
  observations: MetricObservation[],
  metricId: string,
  value: unknown,
): void {
  if (typeof value === "number") {
    observations.push({ metricId, value });
  }
}
