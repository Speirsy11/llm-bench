import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HandshakeReply,
  PluginManifest,
  RunEvent,
  RunResult,
} from "@speirsy11/llm-bench-harness-sdk";
import {
  decodeProtocolLine,
  encodeProtocolLine,
  PLUGIN_PROTOCOL_VERSION,
} from "@speirsy11/llm-bench-harness-sdk";

export const EXAMPLE_PLUGIN_MANIFEST = {
  id: "example-harness-plugin",
  name: "LLMBench example repair plugin",
  version: "1.0.0",
  description:
    "Deterministically repairs the TypeScript clamp tracer without credentials.",
  capabilities: ["response_generation", "workspaces", "files"],
  modelRoutes: [
    {
      id: "example-clamp-repair",
      provider: "example",
      model: "deterministic-clamp-repair",
    },
  ],
} as const satisfies PluginManifest;

const CLAMP_PATCH = `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}
module.exports = { clamp };
`;

export async function runPluginSession(
  input: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void> {
  const iterator = input[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return;

  const request = decodeProtocolLine(first.value);
  if (request.kind !== "handshake_request") {
    throw new Error("Example plugin expected a handshake_request.");
  }

  const reply: HandshakeReply = {
    kind: "handshake_reply",
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    manifest: EXAMPLE_PLUGIN_MANIFEST,
  };
  write(encodeProtocolLine(reply));

  const second = await iterator.next();
  if (second.done) return;
  const run = decodeProtocolLine(second.value);
  if (run.kind !== "run_request") {
    throw new Error("Example plugin expected a run_request after handshake.");
  }

  const started: RunEvent = {
    kind: "run_event",
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    sequence: 0,
    event: { type: "started" },
  };
  write(encodeProtocolLine(started));

  const benchmarkCase = `${run.case.benchmarkId} ${run.case.benchmarkVersion} / ${run.case.id}`;
  if (benchmarkCase !== "repository-repair 1.0.0 / typescript-clamp-bounds") {
    const unsupported: RunResult = {
      kind: "run_result",
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      status: "failed",
      error:
        "Unsupported benchmark case; this example handles repository-repair 1.0.0 / typescript-clamp-bounds.",
      checkpoint: null,
    };
    write(encodeProtocolLine(unsupported));
    return;
  }

  if (Object.keys(run.credentials).length > 0) {
    const denied: RunResult = {
      kind: "run_result",
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      status: "failed",
      error:
        "This example plugin does not accept credential grants; remove them and retry.",
      checkpoint: null,
    };
    write(encodeProtocolLine(denied));
    return;
  }

  if (!run.toolset.tools.includes("apply_patch")) {
    const incompatible: RunResult = {
      kind: "run_result",
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      status: "failed",
      error: "The selected toolset must explicitly include apply_patch.",
      checkpoint: null,
    };
    write(encodeProtocolLine(incompatible));
    return;
  }

  await writeFile(
    join(run.workspace.root, "src/clamp.cjs"),
    CLAMP_PATCH,
    "utf8",
  );
  const progress: RunEvent = {
    kind: "run_event",
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    sequence: 1,
    event: {
      type: "progress",
      message: "Applied the clamp repair with tool apply_patch.",
    },
  };
  write(encodeProtocolLine(progress));

  const result: RunResult = {
    kind: "run_result",
    protocolVersion: PLUGIN_PROTOCOL_VERSION,
    status: "completed",
    output: `Repaired ${run.case.id}.`,
    observations: [],
    checkpoint: null,
    metadata: {
      toolset: run.toolset,
      credentialGrants: Object.keys(run.credentials),
    },
  };
  write(encodeProtocolLine(result));
}
