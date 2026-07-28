import { isDeepStrictEqual } from "node:util";
import type {
  HandshakeReply,
  PluginCredentials,
  PluginManifest,
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
}

interface ExecutablePluginHarnessOptions {
  runner?: ProcessRunner;
  environment?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

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
    const messages = processResult.stdoutLines.map((line) =>
      decodeProtocolLine(line),
    );
    const [handshake, ...transcript] = messages;
    assertHandshake(handshake, this.installation);
    const runTranscript = transcript.map((message) => {
      if (message.kind !== "run_event" && message.kind !== "run_result") {
        throw new Error(
          `Plugin ${this.installation.manifest.id} emitted an unexpected ${message.kind} after its handshake.`,
        );
      }
      return message;
    });
    assertValidRunTranscript(runTranscript);
    const terminal = runTranscript.at(-1) as RunResult;
    return adapterResult(request.jobId, runTranscript, terminal);
  }
}

function pluginRunRequest(
  request: AdapterRunRequest,
  attemptId: string,
  credentials: PluginCredentials,
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
  };
}

function assertHandshake(
  message: ReturnType<typeof decodeProtocolLine> | undefined,
  installation: ExecutablePluginInstallation,
): asserts message is HandshakeReply {
  if (message?.kind !== "handshake_reply") {
    throw new Error(
      `Plugin ${installation.manifest.id} did not begin with a handshake reply.`,
    );
  }
  if (message.protocolVersion !== installation.protocolVersion) {
    throw new Error(
      `Plugin ${installation.manifest.id} protocol changed after installation: expected ${installation.protocolVersion}, received ${message.protocolVersion}. Reinstall the plugin.`,
    );
  }
  const advertised = coreManifest(message.manifest);
  if (!isDeepStrictEqual(advertised, installation.manifest)) {
    throw new Error(
      `Plugin ${installation.manifest.id} manifest changed after installation. Reinstall the plugin.`,
    );
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
