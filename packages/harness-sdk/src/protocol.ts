import { z } from "zod";

/** The largest permitted serialized JSONL message, excluding its optional LF. */
export const MAX_PROTOCOL_LINE_BYTES = 1_048_576;
export const PLUGIN_PROTOCOL_VERSION = "1.0.0" as const;
export const SUPPORTED_PLUGIN_PROTOCOL_MAJOR = 1;

const ProtocolVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);
const IdentifierSchema = z.string().trim().min(1).max(200);

export const PluginCapabilitySchema = z.enum([
  "response_generation",
  "workspaces",
  "files",
  "shell",
  "structured_output",
  "streaming",
  "session_resume",
  "mcp",
  "usage_reporting",
]);

export const PluginManifestSchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string().trim().min(1).max(200),
  version: ProtocolVersionSchema,
  capabilities: z.array(PluginCapabilitySchema).max(32),
  modelRoutes: z
    .array(
      z.strictObject({
        id: IdentifierSchema,
        provider: IdentifierSchema,
        model: IdentifierSchema,
      }),
    )
    .max(128),
  description: z.string().trim().min(1).max(2_000).optional(),
});

export const HandshakeRequestSchema = z.strictObject({
  kind: z.literal("handshake_request"),
  protocolVersion: ProtocolVersionSchema,
});

export const HandshakeReplySchema = z.strictObject({
  kind: z.literal("handshake_reply"),
  protocolVersion: ProtocolVersionSchema,
  manifest: PluginManifestSchema,
});

export const PluginCheckpointSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  resumable: z.boolean(),
  state: z.record(z.string(), z.unknown()),
});

export const PluginJobSchema = z.strictObject({
  id: z.uuid(),
  attemptId: z.uuid(),
});

export const PluginCaseSchema = z.strictObject({
  id: IdentifierSchema,
  benchmarkId: IdentifierSchema,
  benchmarkVersion: ProtocolVersionSchema,
});

export const PluginWorkspaceSchema = z.strictObject({
  root: z.string().min(1).max(4_096),
});

export const PluginToolsetSchema = z.strictObject({
  id: IdentifierSchema,
  version: ProtocolVersionSchema,
  tools: z.array(IdentifierSchema).max(256),
  mcpProfiles: z
    .array(
      z.strictObject({
        id: IdentifierSchema,
        version: ProtocolVersionSchema,
        contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    )
    .max(128),
});

export const PluginMcpConnectionSchema = z.strictObject({
  profile: z.strictObject({
    id: IdentifierSchema,
    version: ProtocolVersionSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  transport: z.literal("unix"),
  socketPath: z.string().startsWith("/").max(4_096),
});

export const PluginRuntimeSchema = z
  .strictObject({
    mcpConnections: z.array(PluginMcpConnectionSchema).max(128),
  })
  .default({ mcpConnections: [] });

export const PluginLimitsSchema = z.strictObject({
  maxDurationMs: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxTokens: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
});

/**
 * Values are granted explicitly by the runner for one run. An omitted record is
 * deliberately equivalent to no grants; plugin processes must never inherit
 * ambient runner credentials.
 */
export const PluginCredentialsSchema = z
  .record(z.string().trim().min(1).max(200), z.string().min(1).max(32_768))
  .default({});

export const RunRequestSchema = z.strictObject({
  kind: z.literal("run_request"),
  protocolVersion: ProtocolVersionSchema,
  job: PluginJobSchema,
  case: PluginCaseSchema,
  prompt: z.string().min(1).max(1_000_000),
  workspace: PluginWorkspaceSchema,
  toolset: PluginToolsetSchema,
  limits: PluginLimitsSchema,
  checkpoint: PluginCheckpointSchema.nullable(),
  credentials: PluginCredentialsSchema,
  runtime: PluginRuntimeSchema,
});

export const PluginEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("started") }),
  z.strictObject({
    type: z.literal("progress"),
    message: z.string().min(1).max(10_000),
  }),
  z.strictObject({
    type: z.literal("checkpoint"),
    checkpoint: PluginCheckpointSchema,
  }),
]);

export const RunEventSchema = z.strictObject({
  kind: z.literal("run_event"),
  protocolVersion: ProtocolVersionSchema,
  sequence: z.number().int().nonnegative(),
  event: PluginEventSchema,
});

export const RunResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    kind: z.literal("run_result"),
    protocolVersion: ProtocolVersionSchema,
    status: z.literal("completed"),
    output: z.string().max(1_000_000),
    observations: z
      .array(
        z.strictObject({
          metricId: IdentifierSchema,
          value: z.number().nullable(),
        }),
      )
      .max(1_000),
    checkpoint: PluginCheckpointSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    kind: z.literal("run_result"),
    protocolVersion: ProtocolVersionSchema,
    status: z.literal("failed"),
    error: z.string().min(1).max(10_000),
    checkpoint: PluginCheckpointSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("run_result"),
    protocolVersion: ProtocolVersionSchema,
    status: z.literal("cancelled"),
    checkpoint: PluginCheckpointSchema.nullable(),
  }),
]);

export const PluginMessageSchema = z.discriminatedUnion("kind", [
  HandshakeRequestSchema,
  HandshakeReplySchema,
  RunRequestSchema,
  RunEventSchema,
  RunResultSchema,
]);

export type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>;
export type HandshakeReply = z.infer<typeof HandshakeReplySchema>;
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;
export type PluginCheckpoint = z.infer<typeof PluginCheckpointSchema>;
export type PluginCredentials = z.output<typeof PluginCredentialsSchema>;
export type PluginLimits = z.infer<typeof PluginLimitsSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginMcpConnection = z.infer<typeof PluginMcpConnectionSchema>;
export type PluginMessage = z.infer<typeof PluginMessageSchema>;
export type PluginRuntime = z.output<typeof PluginRuntimeSchema>;
export type PluginToolset = z.infer<typeof PluginToolsetSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunRequest = z.output<typeof RunRequestSchema>;
export type RunResult = z.infer<typeof RunResultSchema>;

export class PluginProtocolVersionError extends Error {
  readonly receivedVersion: string;
  readonly supportedMajor: number;

  constructor(receivedVersion: string, supportedMajor: number) {
    super(
      `Unsupported plugin protocol version "${receivedVersion}" (received major ${receivedVersion.split(".")[0]}; supported major ${supportedMajor}). Update or reinstall the plugin to a compatible version.`,
    );
    this.name = "PluginProtocolVersionError";
    this.receivedVersion = receivedVersion;
    this.supportedMajor = supportedMajor;
  }
}

export function assertCompatibleProtocolVersion(version: string): void {
  const parsed = ProtocolVersionSchema.safeParse(version);
  if (
    !parsed.success ||
    Number(version.split(".")[0]) !== SUPPORTED_PLUGIN_PROTOCOL_MAJOR
  ) {
    throw new PluginProtocolVersionError(
      version,
      SUPPORTED_PLUGIN_PROTOCOL_MAJOR,
    );
  }
}

function lineByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertSingleBoundedLine(line: string): void {
  const withoutTerminalNewline = line.endsWith("\r\n")
    ? line.slice(0, -2)
    : line.endsWith("\n")
      ? line.slice(0, -1)
      : line;
  if (
    withoutTerminalNewline.length === 0 ||
    /[\r\n]/u.test(withoutTerminalNewline)
  ) {
    throw new Error(
      "Plugin protocol input must contain exactly one non-empty JSONL line.",
    );
  }
  if (lineByteLength(withoutTerminalNewline) > MAX_PROTOCOL_LINE_BYTES) {
    throw new Error(
      `Plugin protocol line exceeds the ${MAX_PROTOCOL_LINE_BYTES}-byte limit.`,
    );
  }
}

/** Serialize one validated protocol message as exactly one newline-terminated JSONL line. */
export function encodeProtocolLine(message: PluginMessage): string {
  const serialized = JSON.stringify(PluginMessageSchema.parse(message));
  assertSingleBoundedLine(serialized);
  return `${serialized}\n`;
}

/** Parse one bounded JSONL line and reject unknown fields and incompatible majors. */
export function decodeProtocolLine(line: string): PluginMessage {
  assertSingleBoundedLine(line);
  const content = line.endsWith("\r\n")
    ? line.slice(0, -2)
    : line.replace(/\n$/u, "");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Plugin protocol input is not valid JSON.");
  }
  const message = PluginMessageSchema.parse(value);
  assertCompatibleProtocolVersion(message.protocolVersion);
  return message;
}

/**
 * Verify an ordered run transcript. A plugin may emit zero or more contiguous
 * events, followed by exactly one terminal result and nothing after it.
 */
export function assertValidRunTranscript(
  messages: readonly (RunEvent | RunResult)[],
): void {
  let expectedSequence = 0;
  let terminalSeen = false;
  for (const message of messages) {
    if (message.kind === "run_result") {
      if (terminalSeen) {
        throw new Error(
          "Plugin run transcript contains more than one terminal result.",
        );
      }
      terminalSeen = true;
      continue;
    }
    if (terminalSeen) {
      throw new Error(
        "Plugin run transcript contains an event after its terminal result.",
      );
    }
    if (message.sequence !== expectedSequence) {
      throw new Error(
        `Plugin run event sequence must be ordered: expected ${expectedSequence}, received ${message.sequence}.`,
      );
    }
    expectedSequence += 1;
  }
  if (!terminalSeen) {
    throw new Error(
      "Plugin run transcript must contain exactly one terminal result.",
    );
  }
}
