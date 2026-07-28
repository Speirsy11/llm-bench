import { spawn } from "node:child_process";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { ChildProcess } from "node:child_process";
import type { Server, Socket } from "node:net";

import {
  isolatedProcessEnvironment,
  terminateProcessGroup,
} from "@llm-bench/process-harness";

import type {
  McpProbeResult,
  McpProfile,
  McpSessionOptions,
  SecretResolver,
} from "./types";
import { verifyMcpProfileArtifacts } from "./registry";

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const MAX_BRIDGE_REQUEST_BYTES = 1024 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-06-18"]);

interface PendingRequest {
  reject(error: Error): void;
  resolve(result: unknown): void;
}

/** The request seam required by a job-scoped MCP bridge. */
export interface McpRequestSession {
  request(
    method: string,
    params?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface McpUnixBridgeOptions {
  root: string;
  socketName: string;
}

export interface McpUnixBridge {
  socketPath: string;
  stop(): Promise<void>;
}

/** A live runner-local MCP stdio connection. */
export class McpSession {
  readonly #child: ChildProcess;
  readonly #options: Required<
    Pick<
      McpSessionOptions,
      | "maxOutputBytes"
      | "maxStderrBytes"
      | "requestTimeoutMs"
      | "startupTimeoutMs"
    >
  >;
  #capabilities: McpProbeResult | undefined;
  #closed = false;
  #closePromise: Promise<void>;
  #failure: Error | undefined;
  #resolveClosed!: () => void;
  #stderrBytes = 0;
  #nextRequestId = 2;
  #pending:
    | { reject(error: Error): void; resolve(result: McpProbeResult): void }
    | undefined;
  readonly #requests = new Map<number, PendingRequest>();
  readonly #secrets: readonly string[];
  #stopPromise: Promise<void> | undefined;
  #stdout = "";
  readonly #stdoutDecoder = new StringDecoder("utf8");

  constructor(
    readonly profile: McpProfile,
    child: ChildProcess,
    options: Required<
      Pick<
        McpSessionOptions,
        | "maxOutputBytes"
        | "maxStderrBytes"
        | "requestTimeoutMs"
        | "startupTimeoutMs"
      >
    >,
    secrets: readonly string[],
  ) {
    this.#child = child;
    this.#options = options;
    this.#secrets = secrets;
    this.#closePromise = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    this.#child.stdout?.on("data", (chunk: Buffer) =>
      this.#onOutput("stdout", chunk),
    );
    this.#child.stderr?.on("data", (chunk: Buffer) =>
      this.#onOutput("stderr", chunk),
    );
    this.#child.once("close", () => this.#onClose());
  }

  get capabilities(): McpProbeResult | undefined {
    return this.#capabilities === undefined
      ? undefined
      : structuredClone(this.#capabilities);
  }

  async probe(signal?: AbortSignal): Promise<McpProbeResult> {
    if (this.#capabilities !== undefined)
      return structuredClone(this.#capabilities);
    if (this.#closed || signal?.aborted)
      throw new Error("MCP session is not running.");
    if (this.#pending !== undefined)
      throw new Error("MCP session probe is already running.");

    return new Promise<McpProbeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending = undefined;
        const error = new Error(
          `MCP server '${this.profile.metadata.id}' did not initialize within ${this.#options.startupTimeoutMs}ms.`,
        );
        reject(error);
        void this.stop();
      }, this.#options.startupTimeoutMs);
      const onAbort = () => {
        clearTimeout(timeout);
        this.#pending = undefined;
        reject(new Error("MCP session was cancelled."));
        void this.stop();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending = {
        resolve: (result) => {
          clearTimeout(timeout);
          /* v8 ignore next -- listener presence is owned by AbortSignal internals. */
          signal?.removeEventListener("abort", onAbort);
          this.#pending = undefined;
          this.#capabilities = result;
          resolve(structuredClone(result));
        },
        reject: (error) => {
          clearTimeout(timeout);
          /* v8 ignore next -- listener presence is owned by AbortSignal internals. */
          signal?.removeEventListener("abort", onAbort);
          this.#pending = undefined;
          reject(error);
        },
      };
      this.#child.stdin?.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "llm-bench", version: "1" },
          },
        })}\n`,
      );
    });
  }

  async stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async request(
    method: string,
    params: unknown = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.#capabilities === undefined)
      throw new Error("MCP session has not initialized.");
    if (this.#closed || signal?.aborted)
      throw new Error("MCP session is not running.");

    const id = this.#nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#requests.delete(id);
        reject(
          new Error(
            `MCP request '${method}' timed out after ${this.#options.requestTimeoutMs}ms.`,
          ),
        );
      }, this.#options.requestTimeoutMs);
      const onAbort = () => {
        clearTimeout(timeout);
        this.#requests.delete(id);
        reject(new Error("MCP request was cancelled."));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#requests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          this.#requests.delete(id);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          this.#requests.delete(id);
          reject(error);
        },
      });
      this.#child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  async #stop(): Promise<void> {
    if (!this.#closed) terminateProcessGroup(this.#child, "SIGTERM");
    const escalation = setTimeout(
      () => terminateProcessGroup(this.#child, "SIGKILL"),
      250,
    );
    escalation.unref();
    await this.#closePromise;
    clearTimeout(escalation);
  }

  #onOutput(source: "stdout" | "stderr", chunk: Buffer): void {
    if (source === "stderr") {
      this.#stderrBytes += chunk.byteLength;
      if (this.#stderrBytes > this.#options.maxStderrBytes) {
        this.#fail(
          new Error(
            `MCP server stderr exceeded ${this.#options.maxStderrBytes} bytes.`,
          ),
        );
      }
      return;
    }
    this.#stdout += this.#stdoutDecoder.write(chunk);
    const lines = this.#stdout.split(/\r?\n/u);
    const [incomplete] = lines.slice(-1) as [string];
    lines.pop();
    this.#stdout = incomplete;
    if (Buffer.byteLength(this.#stdout) > this.#options.maxOutputBytes) {
      this.#fail(outputLimitError(this.#options.maxOutputBytes));
      return;
    }
    for (const line of lines) {
      if (Buffer.byteLength(line) > this.#options.maxOutputBytes) {
        this.#fail(outputLimitError(this.#options.maxOutputBytes));
        return;
      }
      this.#onMessage(line);
    }
  }

  #onMessage(line: string): void {
    if (line.length === 0) return;
    try {
      const message: unknown = JSON.parse(line);
      if (this.#pending !== undefined) {
        const id = responseId(message);
        if (id !== undefined && id !== 1) return;
        const result = redactValue(
          parseInitializeResult(message),
          this.#secrets,
        ) as McpProbeResult;
        this.#child.stdin?.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          })}\n`,
        );
        this.#pending.resolve(result);
        return;
      }
      const id = responseId(message);
      /* v8 ignore next -- unsolicited server notifications are intentionally ignored. */
      if (id === undefined) return;
      const pending = this.#requests.get(id);
      if (pending === undefined) return;
      const response = message as { error?: unknown; result?: unknown };
      if (response.error !== undefined) {
        pending.reject(
          new Error(redactText(parseMcpError(response.error), this.#secrets)),
        );
        return;
      }
      /* v8 ignore next -- malformed matched replies are contained by the outer failure path. */
      if (!("result" in response)) throw new Error("Invalid response.");
      pending.resolve(redactValue(response.result, this.#secrets));
    } catch (error) {
      this.#fail(
        error instanceof Error &&
          error.message.startsWith("MCP server negotiated")
          ? error
          : new Error(
              /* v8 ignore next -- generic malformed-reply wording is defensive. */
              this.#capabilities === undefined
                ? "MCP server returned an invalid initialize response."
                : "MCP server returned an invalid JSON-RPC response.",
            ),
      );
    }
  }

  #onClose(): void {
    this.#stdout += this.#stdoutDecoder.end();
    this.#closed = true;
    this.#child.stdin?.end();
    this.#pending?.reject(
      this.#failure ??
        new Error("MCP server exited before initialization completed."),
    );
    for (const request of this.#requests.values()) {
      request.reject(
        this.#failure ?? new Error("MCP server exited before replying."),
      );
    }
    this.#resolveClosed();
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#pending?.reject(error);
    void this.stop();
  }
}

/**
 * Exposes one initialized runner-local stdio session to a plugin process without
 * disclosing the session's command, environment, or resolved secrets.
 */
export async function startMcpUnixBridge(
  session: McpRequestSession,
  options: McpUnixBridgeOptions,
): Promise<McpUnixBridge> {
  if (
    options.socketName.length === 0 ||
    basename(options.socketName) !== options.socketName
  ) {
    throw new Error("MCP bridge socketName must be a safe basename.");
  }
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  await chmod(options.root, 0o700);
  const socketPath = join(options.root, options.socketName);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    bridgeSocket(socket, session);
  });
  let listening = false;
  try {
    await listen(server, socketPath);
    listening = true;
    await chmod(socketPath, 0o600);
  } catch (error) {
    /* v8 ignore start -- requires an OS-level race after a successful listen. */
    if (listening) await stopBridge(server, sockets, socketPath);
    /* v8 ignore stop */
    throw error;
  }

  let stopPromise: Promise<void> | undefined;
  return {
    socketPath,
    stop: () => {
      stopPromise ??= stopBridge(server, sockets, socketPath);
      return stopPromise;
    },
  };
}

/** Starts a runner-local server with a deliberately minimal process environment. */
export async function startMcpSession(
  profile: McpProfile,
  resolveSecret: SecretResolver,
  options: McpSessionOptions = {},
): Promise<McpSession> {
  if (options.signal?.aborted) throw new Error("MCP session was cancelled.");
  let child: ChildProcess | undefined;
  let session: McpSession | undefined;
  let preSessionStop: Promise<void> | undefined;
  const stopBeforeSession = (): Promise<void> => {
    if (child === undefined) return Promise.resolve();
    preSessionStop ??= terminateSpawnedChild(child);
    return preSessionStop;
  };
  const onAbort = () => {
    if (session !== undefined) void session.stop();
    else void stopBeforeSession();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await verifyMcpProfileArtifacts(profile);
    const resolved = await resolvedEnvironment(profile, resolveSecret);
    if (options.signal?.aborted) throw new Error("MCP session was cancelled.");
    const launch = await verifyMcpProfileArtifacts(profile);
    if (options.signal?.aborted) throw new Error("MCP session was cancelled.");
    const [command, ...args] = launch.argv;
    child = spawn(command, args, {
      cwd: launch.cwd,
      detached: true,
      env: resolved.environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await waitForSpawn(child);
    if (options.signal?.aborted) {
      await stopBeforeSession();
      throw new Error("MCP session was cancelled.");
    }
    session = new McpSession(
      profile,
      child,
      {
        maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        maxStderrBytes: options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
        requestTimeoutMs:
          options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        startupTimeoutMs:
          options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      },
      resolved.secrets,
    );
    return session;
  } catch (error) {
    if (session === undefined) {
      options.signal?.removeEventListener("abort", onAbort);
      await stopBeforeSession();
    }
    throw error;
  }
}

async function terminateSpawnedChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  terminateProcessGroup(child, "SIGTERM");
  const escalation = setTimeout(
    () => terminateProcessGroup(child, "SIGKILL"),
    250,
  );
  escalation.unref();
  await closed;
  clearTimeout(escalation);
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.removeListener("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.removeListener("spawn", onSpawn);
      child.kill();
      reject(new Error(`MCP server could not start: ${error.message}`));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function resolvedEnvironment(
  profile: McpProfile,
  resolveSecret: SecretResolver,
): Promise<{ environment: NodeJS.ProcessEnv; secrets: string[] }> {
  const grants: NodeJS.ProcessEnv = {};
  const secrets = new Set<string>();
  for (const [name, reference] of Object.entries(
    profile.local.secretReferences,
  )) {
    const secret = await resolveSecret(reference);
    if (secret === undefined) {
      throw new Error(
        `MCP secret '${reference}' for ${name} could not be resolved.`,
      );
    }
    grants[name] = secret;
    if (secret.length > 0) secrets.add(secret);
  }
  return {
    environment: isolatedProcessEnvironment(process.env, grants),
    secrets: [...secrets].sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    ),
  };
}

function parseInitializeResult(value: unknown): McpProbeResult {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid response.");
  const message = value as {
    id?: unknown;
    jsonrpc?: unknown;
    result?: unknown;
  };
  if (
    message.jsonrpc !== "2.0" ||
    message.id !== 1 ||
    typeof message.result !== "object" ||
    message.result === null
  ) {
    throw new Error("Invalid response.");
  }
  const result = message.result as {
    capabilities?: unknown;
    protocolVersion?: unknown;
  };
  if (
    typeof result.capabilities !== "object" ||
    result.capabilities === null ||
    Array.isArray(result.capabilities)
  ) {
    throw new Error("Invalid response.");
  }
  if (result.protocolVersion === undefined) {
    throw new Error("MCP server negotiated an unsupported protocol version.");
  }
  if (typeof result.protocolVersion !== "string") {
    throw new Error("Invalid response.");
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
    throw new Error("MCP server negotiated an unsupported protocol version.");
  }
  return {
    capabilities: result.capabilities as Record<string, unknown>,
    protocolVersion: result.protocolVersion,
  };
}

function outputLimitError(limit: number): Error {
  return new Error(`MCP server output exceeded ${limit} bytes.`);
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, secrets));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactText(key, secrets),
      redactValue(item, secrets),
    ]),
  );
}

function redactText(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function responseId(value: unknown): number | undefined {
  /* v8 ignore next -- defensive parsing for untrusted server output. */
  if (typeof value !== "object" || value === null) return undefined;
  const message = value as { id?: unknown; jsonrpc?: unknown };
  /* v8 ignore next -- defensive parsing for untrusted server output. */
  return message.jsonrpc === "2.0" && typeof message.id === "number"
    ? message.id
    : undefined;
}

function parseMcpError(value: unknown): string {
  /* v8 ignore next -- fallback shapes are defensive for non-conforming servers. */
  if (typeof value !== "object" || value === null)
    return "MCP server returned an error.";
  const error = value as { code?: unknown; message?: unknown };
  /* v8 ignore next -- fallback shapes are defensive for non-conforming servers. */
  const message =
    typeof error.message === "string"
      ? error.message
      : "MCP server returned an error.";
  /* v8 ignore next -- fallback shapes are defensive for non-conforming servers. */
  return typeof error.code === "number"
    ? `${message} (JSON-RPC ${error.code})`
    : message;
}

function bridgeSocket(socket: Socket, session: McpRequestSession): void {
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  let decoderEnded = false;
  const endDecoder = () => {
    if (decoderEnded) return;
    decoderEnded = true;
    buffer += decoder.end();
    if (Buffer.byteLength(buffer) > MAX_BRIDGE_REQUEST_BYTES) {
      socket.destroy(new Error("MCP bridge request exceeded its size limit."));
    }
  };
  socket.on("error", () => {
    // The bridge contains malformed/oversized client failures per connection.
  });
  socket.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    if (Buffer.byteLength(buffer) > MAX_BRIDGE_REQUEST_BYTES) {
      socket.destroy(new Error("MCP bridge request exceeded its size limit."));
      return;
    }
    const lines = buffer.split(/\r?\n/u);
    const [incomplete] = lines.slice(-1) as [string];
    lines.pop();
    buffer = incomplete;
    for (const line of lines) {
      if (line.length > 0) void forwardBridgeRequest(socket, session, line);
    }
  });
  socket.once("end", endDecoder);
  socket.once("close", endDecoder);
}

async function forwardBridgeRequest(
  socket: Socket,
  session: McpRequestSession,
  line: string,
): Promise<void> {
  let id: string | number | null = null;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null)
      throw new Error("Invalid JSON-RPC request.");
    const request = value as {
      id?: unknown;
      jsonrpc?: unknown;
      method?: unknown;
      params?: unknown;
    };
    /* v8 ignore next -- exhaustive validation branches share one public error. */
    if (
      request.jsonrpc !== "2.0" ||
      (typeof request.id !== "string" && typeof request.id !== "number") ||
      typeof request.method !== "string"
    ) {
      throw new Error("Invalid JSON-RPC request.");
    }
    id = request.id;
    const result = await session.request(request.method, request.params ?? {});
    writeBridgeResponse(socket, { jsonrpc: "2.0", id, result });
  } catch (error) {
    writeBridgeResponse(socket, {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        /* v8 ignore next -- promise contracts normally reject Error instances. */
        message: error instanceof Error ? error.message : "MCP request failed.",
      },
    });
  }
}

function writeBridgeResponse(socket: Socket, response: unknown): void {
  /* v8 ignore next -- peer-close races are timing-dependent. */
  if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function stopBridge(
  server: Server,
  sockets: ReadonlySet<Socket>,
  socketPath: string,
): Promise<void> {
  /* v8 ignore next -- active-peer timing is covered by connection containment. */
  for (const socket of sockets) socket.destroy();
  if (server.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        /* v8 ignore next -- node only reports close errors for invalid server state. */
        return error === undefined ? resolve() : reject(error);
      }),
    );
  }
  await unlink(socketPath).catch((error: unknown) => {
    /* v8 ignore next -- non-ENOENT unlink failures are propagated defensively. */
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  });
}
