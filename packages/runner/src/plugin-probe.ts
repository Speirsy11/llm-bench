import { dirname } from "node:path";
import {
  decodeProtocolLine,
  encodeProtocolLine,
  PLUGIN_PROTOCOL_VERSION,
} from "@speirsy11/llm-bench-harness-sdk";

import type { ProcessRunner } from "@llm-bench/process-harness";
import {
  isolatedProcessEnvironment,
  NodeProcessRunner,
} from "@llm-bench/process-harness";

import type { PluginProbeResult } from "./plugin-registry";

interface PluginProbeOptions {
  runner?: ProcessRunner;
  environment?: NodeJS.ProcessEnv;
}

/** Runs a bounded, credential-free installation handshake. */
export async function probeExecutablePlugin(
  argv: readonly [string, ...string[]],
  options: PluginProbeOptions = {},
): Promise<PluginProbeResult> {
  const result = await (options.runner ?? new NodeProcessRunner()).run({
    argv: [...argv],
    cwd: dirname(argv[0]),
    env: isolatedProcessEnvironment(options.environment, {}),
    stdin: encodeProtocolLine({
      kind: "handshake_request",
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
    }),
    signal: AbortSignal.timeout(5_000),
    maxOutputBytes: 1_048_576,
  });
  if (result.exitCode !== 0) {
    const detail =
      result.stderr.trim().length > 0 ? `: ${result.stderr.trim()}` : "";
    throw new Error(
      `Plugin probe exited with code ${String(result.exitCode)}${detail}`,
    );
  }
  if (result.stdoutLines.length !== 1) {
    throw new Error("Plugin probe must return exactly one handshake reply.");
  }
  const reply = decodeProtocolLine(result.stdoutLines.join(""));
  if (reply.kind !== "handshake_reply") {
    throw new Error("Plugin probe must return exactly one handshake reply.");
  }
  return {
    protocolVersion: reply.protocolVersion,
    manifest: reply.manifest,
  };
}
