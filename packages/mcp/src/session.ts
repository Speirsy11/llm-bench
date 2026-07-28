import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

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

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;

/** A live runner-local MCP stdio connection. */
export class McpSession {
  readonly #child: ChildProcess;
  readonly #options: Required<
    Pick<McpSessionOptions, "maxOutputBytes" | "startupTimeoutMs">
  >;
  #capabilities: McpProbeResult | undefined;
  #closed = false;
  #closePromise: Promise<void>;
  #failure: Error | undefined;
  #resolveClosed!: () => void;
  #outputBytes = 0;
  #pending:
    | { reject(error: Error): void; resolve(result: McpProbeResult): void }
    | undefined;
  #stopPromise: Promise<void> | undefined;
  #stdout = "";

  constructor(
    readonly profile: McpProfile,
    child: ChildProcess,
    options: Required<
      Pick<McpSessionOptions, "maxOutputBytes" | "startupTimeoutMs">
    >,
  ) {
    this.#child = child;
    this.#options = options;
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
          signal?.removeEventListener("abort", onAbort);
          this.#pending = undefined;
          this.#capabilities = result;
          resolve(structuredClone(result));
        },
        reject: (error) => {
          clearTimeout(timeout);
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
    this.#outputBytes += chunk.byteLength;
    if (this.#outputBytes > this.#options.maxOutputBytes) {
      this.#fail(
        new Error(
          `MCP server output exceeded ${this.#options.maxOutputBytes} bytes.`,
        ),
      );
      return;
    }
    if (source === "stderr") return;
    this.#stdout += chunk.toString("utf8");
    const lines = this.#stdout.split(/\r?\n/u);
    const [incomplete] = lines.slice(-1) as [string];
    lines.pop();
    this.#stdout = incomplete;
    for (const line of lines) this.#onMessage(line);
  }

  #onMessage(line: string): void {
    if (line.length === 0 || this.#pending === undefined) return;
    try {
      const message: unknown = JSON.parse(line);
      const result = parseInitializeResult(message);
      this.#pending.resolve(result);
    } catch {
      this.#fail(
        new Error("MCP server returned an invalid initialize response."),
      );
    }
  }

  #onClose(): void {
    this.#closed = true;
    this.#child.stdin?.end();
    this.#pending?.reject(
      this.#failure ??
        new Error("MCP server exited before initialization completed."),
    );
    this.#resolveClosed();
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#pending?.reject(error);
    void this.stop();
  }
}

/** Starts a runner-local server with a deliberately minimal process environment. */
export async function startMcpSession(
  profile: McpProfile,
  resolveSecret: SecretResolver,
  options: McpSessionOptions = {},
): Promise<McpSession> {
  if (options.signal?.aborted) throw new Error("MCP session was cancelled.");
  const environment = await resolvedEnvironment(profile, resolveSecret);
  if (options.signal?.aborted) throw new Error("MCP session was cancelled.");
  const [command, ...args] = profile.local.argv;
  const child = spawn(command, args, {
    cwd: profile.local.cwd,
    detached: true,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  await waitForSpawn(child);
  const session = new McpSession(profile, child, {
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
  });
  const onAbort = () => void session.stop();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  return session;
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
): Promise<NodeJS.ProcessEnv> {
  const grants: NodeJS.ProcessEnv = {};
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
  }
  return isolatedProcessEnvironment(process.env, grants);
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
  if (
    result.protocolVersion !== undefined &&
    typeof result.protocolVersion !== "string"
  ) {
    throw new Error("Invalid response.");
  }
  return {
    capabilities: result.capabilities as Record<string, unknown>,
    protocolVersion: result.protocolVersion,
  };
}
