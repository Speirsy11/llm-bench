import { isDeepStrictEqual } from "node:util";
import type {
  HandshakeReply,
  PluginCheckpoint,
  PluginCredentials,
  PluginManifest,
  PluginMcpConnection,
  RunEvent,
  RunRequest,
  RunResult,
} from "@speirsy11/llm-bench-harness-sdk";
import {
  assertValidRunTranscript,
  decodeProtocolLine,
  encodeProtocolLine,
} from "@speirsy11/llm-bench-harness-sdk";

import type {
  AdapterRunRequest,
  AdapterRunResult,
  HarnessManifest,
} from "@llm-bench/contracts";
import type { ProcessRunner } from "@llm-bench/process-harness";
import {
  HarnessManifestSchema,
  MetricObservationSchema,
} from "@llm-bench/contracts";
import {
  isolatedProcessEnvironment,
  NodeProcessRunner,
} from "@llm-bench/process-harness";

export interface ExecutablePluginInstallation {
  argv: [string, ...string[]];
  protocolVersion: string;
  manifest: HarnessManifest;
}

export interface ExecutablePluginRunOptions {
  attemptId: string;
  credentials?: PluginCredentials;
  mcpConnections?: readonly PluginMcpConnection[];
}

interface ExecutablePluginHarnessOptions {
  runner?: ProcessRunner;
  environment?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

type PluginEvent = RunEvent["event"];

/**
 * Per-job executable plugin boundary. The child receives one handshake and one
 * run request, then must exit after exactly one valid terminal transcript.
 */
export class ExecutablePluginHarness {
  constructor(
    readonly installation: ExecutablePluginInstallation,
    private readonly options: ExecutablePluginHarnessOptions = {},
  ) {}

  async run(
    request: AdapterRunRequest,
    options: ExecutablePluginRunOptions,
  ): Promise<AdapterRunResult> {
    const credentials = options.credentials ?? {};
    const runRequest = pluginRunRequest(
      request,
      options.attemptId,
      credentials,
      options.mcpConnections ?? [],
      this.installation.protocolVersion,
    );
    const stdin =
      encodeProtocolLine({
        kind: "handshake_request",
        protocolVersion: this.installation.protocolVersion,
      }) + encodeProtocolLine(runRequest);
    const processResult = await (
      this.options.runner ?? new NodeProcessRunner()
    ).run({
      argv: this.installation.argv,
      cwd: request.workspaceRoot,
      env: isolatedProcessEnvironment(this.options.environment, {}),
      stdin,
      signal: request.signal,
      maxOutputBytes: this.options.maxOutputBytes ?? 10 * 1024 * 1024,
      redact: Object.values(credentials),
      redactStdout: false,
    });
    if (processResult.exitCode !== 0) {
      const detail =
        processResult.stderr.trim().length > 0
          ? `: ${processResult.stderr.trim()}`
          : "";
      throw new Error(
        `Plugin ${this.installation.manifest.id} exited with code ${String(processResult.exitCode)}${detail}`,
      );
    }
    const runTranscript = validatedRunTranscript(
      processResult.stdoutLines,
      this.installation,
    );
    const redact = secretRedactor(Object.values(credentials));
    const safeTranscript = runTranscript.map((message) =>
      redactDecodedRunMessage(message, redact),
    );
    const terminal = safeTranscript.at(-1) as RunResult;
    return adapterResult(request.jobId, safeTranscript, terminal);
  }
}

function validatedRunTranscript(
  stdoutLines: readonly string[],
  installation: ExecutablePluginInstallation,
): readonly (RunEvent | RunResult)[] {
  try {
    const messages = stdoutLines.map((line) => decodeProtocolLine(line));
    const [handshake, ...transcript] = messages;
    assertHandshake(handshake, installation);
    const runTranscript = transcript.map((message) => {
      if (message.kind !== "run_event" && message.kind !== "run_result") {
        throw new Error("Unexpected plugin protocol message.");
      }
      return message;
    });
    assertValidRunTranscript(runTranscript, installation.protocolVersion);
    return runTranscript;
  } catch {
    throw new Error(
      "Installed plugin emitted invalid protocol output. Verify plugin compatibility or reinstall the plugin.",
    );
  }
}

function secretRedactor(secrets: readonly string[]): (value: string) => string {
  const ordered = [
    ...new Set(secrets.filter((secret) => secret.length > 0)),
  ].sort((left, right) => right.length - left.length);
  return (value) => {
    let safe = value;
    for (const secret of ordered) {
      safe = safe.replaceAll(secret, "[REDACTED]");
    }
    return safe;
  };
}

function redactDecodedRunMessage(
  message: RunEvent | RunResult,
  redact: (value: string) => string,
): RunEvent | RunResult {
  if (message.kind === "run_event") {
    return { ...message, event: redactPluginEvent(message.event, redact) };
  }
  const checkpoint = redactCheckpoint(message.checkpoint, redact);
  if (message.status === "completed") {
    return {
      ...message,
      output: redact(message.output),
      observations: message.observations.map((observation) => ({
        ...observation,
        metricId: redact(observation.metricId),
      })),
      checkpoint,
      metadata: redactRecord(message.metadata, redact),
    };
  }
  if (message.status === "failed") {
    return {
      ...message,
      error: redact(message.error),
      checkpoint,
    };
  }
  return { ...message, checkpoint };
}

function redactPluginEvent(
  event: PluginEvent,
  redact: (value: string) => string,
): PluginEvent {
  if (event.type === "progress") {
    return { ...event, message: redact(event.message) };
  }
  if (event.type === "checkpoint") {
    return {
      ...event,
      checkpoint: {
        ...event.checkpoint,
        state: redactRecord(event.checkpoint.state, redact),
      },
    };
  }
  return event;
}

function redactCheckpoint(
  checkpoint: PluginCheckpoint | null,
  redact: (value: string) => string,
): PluginCheckpoint | null {
  if (checkpoint === null) return null;
  return {
    ...checkpoint,
    state: redactRecord(checkpoint.state, redact),
  };
}

function redactRecord(
  value: Record<string, unknown>,
  redact: (value: string) => string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      redact(key),
      redactUnknown(child, redact),
    ]),
  );
}

function redactUnknown(
  value: unknown,
  redact: (value: string) => string,
): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, redact));
  }
  if (value !== null && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, redact);
  }
  return value;
}

function pluginRunRequest(
  request: AdapterRunRequest,
  attemptId: string,
  credentials: PluginCredentials,
  mcpConnections: readonly PluginMcpConnection[],
  protocolVersion: string,
): RunRequest {
  const { checkpoint } = request;
  return {
    kind: "run_request",
    protocolVersion,
    job: { id: request.jobId, attemptId },
    case: {
      id: request.caseId,
      benchmarkId: request.benchmark.id,
      benchmarkVersion: request.benchmark.version,
    },
    prompt: request.prompt,
    workspace: { root: request.workspaceRoot },
    toolset: request.toolset,
    limits: {
      ...request.limits,
      maxTurns: request.limits.maxTurns ?? 1,
    },
    checkpoint:
      checkpoint === null
        ? null
        : {
            sequence: checkpoint.sequence,
            resumable: checkpoint.resumable,
            state: checkpoint.state,
          },
    credentials,
    runtime: { mcpConnections: [...mcpConnections] },
  };
}

function assertHandshake(
  message: ReturnType<typeof decodeProtocolLine> | undefined,
  installation: ExecutablePluginInstallation,
): asserts message is HandshakeReply {
  if (message?.kind !== "handshake_reply") {
    throw new Error("Plugin output did not begin with a handshake reply.");
  }
  if (message.protocolVersion !== installation.protocolVersion) {
    throw new Error("Plugin protocol changed after installation.");
  }
  const advertised = coreManifest(message.manifest);
  if (!isDeepStrictEqual(advertised, installation.manifest)) {
    throw new Error("Plugin manifest changed after installation.");
  }
}

function coreManifest(manifest: PluginManifest): HarnessManifest {
  return HarnessManifestSchema.parse({
    id: manifest.id,
    version: manifest.version,
    capabilities: manifest.capabilities,
    modelRoutes: manifest.modelRoutes,
  });
}

function adapterResult(
  jobId: string,
  transcript: readonly (RunEvent | RunResult)[],
  result: RunResult,
): AdapterRunResult {
  const events = transcript
    .filter((message): message is RunEvent => message.kind === "run_event")
    .map((message) => message.event);
  const checkpoint =
    result.checkpoint === null
      ? null
      : {
          jobId,
          sequence: result.checkpoint.sequence,
          resumable: result.checkpoint.resumable,
          state: result.checkpoint.state,
        };
  if (result.status === "completed") {
    return {
      status: "completed",
      output: result.output,
      observations: result.observations.map((observation) =>
        MetricObservationSchema.parse(observation),
      ),
      checkpoint,
      events,
      metadata: result.metadata,
    };
  }
  return {
    status: result.status,
    output: "",
    observations: [],
    checkpoint,
    events,
    metadata: {},
    ...(result.status === "failed" ? { error: result.error } : {}),
  };
}
