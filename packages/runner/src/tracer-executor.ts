import { createHash } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PluginMcpConnection } from "@speirsy11/llm-bench-harness-sdk";

import type {
  AdapterRunRequest,
  BenchmarkEvent,
  Checkpoint,
  PluginExecutionRef,
  RunnerCheckpoint,
  RunnerInventory,
  RunnerLease,
} from "@llm-bench/contracts";
import type { RunnerIdentity } from "@llm-bench/crypto";
import type { HarnessProvider } from "@llm-bench/llm-bench-harness";
import type {
  McpProfile,
  McpProfileRegistry,
  McpRequestSession,
  SecretResolver as McpSecretResolver,
  McpUnixBridge,
  McpUnixBridgeOptions,
} from "@llm-bench/mcp";
import type { FetchLike } from "@llm-bench/openai-compatible";
import type { ProcessRunner } from "@llm-bench/process-harness";
import type { RepairFixtureId } from "@llm-bench/repository-repair";
import type { FixtureHarness } from "@llm-bench/runner-engine";
import { ClaudeHarness } from "@llm-bench/claude-harness";
import { CodexHarness } from "@llm-bench/codex-harness";
import {
  LLMBENCH_REPOSITORY_TOOLS,
  REPOSITORY_REPAIR_REQUIRED_CAPABILITIES,
  targetCompatibilityBlockers,
} from "@llm-bench/contracts";
import {
  createRepositoryTools,
  CredentialResolver,
  LlmBenchHarness,
} from "@llm-bench/llm-bench-harness";
import { startMcpSession, startMcpUnixBridge } from "@llm-bench/mcp";
import { OpenRouterProvider } from "@llm-bench/openai-compatible";
import { PiHarness } from "@llm-bench/pi-harness";
import { repairFixture, repairScenario } from "@llm-bench/repository-repair";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

import type { PluginRegistry } from "./plugin-registry";
import type { RunnerExecutor } from "./worker";
import { ExecutablePluginHarness } from "./plugin-host";

type ProcessTarget = "codex" | "claude" | "pi";
const openRouterCredential = /^sk-or-v1-[A-Za-z0-9_-]{16,}$/u;

export interface TracerExecutorOptions {
  identity?: RunnerIdentity;
  openRouterFetch?: FetchLike;
  processRunners?: Partial<Record<ProcessTarget, ProcessRunner>>;
  inventory?: RunnerInventory;
  pluginRegistry?: Pick<PluginRegistry, "resolveExecution">;
  pluginProcessRunner?: ProcessRunner;
  resolvePluginCredential?: (
    runnerCredentialName: string,
  ) => Promise<string | undefined>;
  mcpRegistry?: Pick<McpProfileRegistry, "get">;
  resolveMcpSecret?: McpSecretResolver;
  startMcp?: (
    profile: McpProfile,
    resolveSecret: McpSecretResolver,
    options: { signal: AbortSignal },
  ) => Promise<McpSessionHandle>;
  startMcpBridge?: (
    session: McpRequestSession,
    options: McpUnixBridgeOptions,
  ) => Promise<McpUnixBridge>;
  deadline?: AbortSignal;
}

interface McpSessionHandle extends McpRequestSession {
  probe(signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<void>;
}

interface McpAwareFixtureHarness extends FixtureHarness {
  repairWithMcp(
    request: Parameters<FixtureHarness["repair"]>[0],
    connections: readonly PluginMcpConnection[],
  ): ReturnType<FixtureHarness["repair"]>;
}

/** Executes versioned repository-repair leases through their selected target. */
export class TracerExecutor implements RunnerExecutor {
  constructor(
    private readonly root: string,
    private readonly options: TracerExecutorOptions = {},
  ) {}

  canResume(lease: RunnerLease, checkpoint: RunnerCheckpoint): boolean {
    const nativeCheckpoint = checkpointFor(lease, checkpoint);
    switch (lease.execution.target.harness.id) {
      case "codex":
        return new CodexHarness({
          manifest: lease.execution.target.harness,
          runner: this.options.processRunners?.codex,
        }).canResume(nativeCheckpoint);
      case "claude":
        return new ClaudeHarness({
          manifest: lease.execution.target.harness,
          runner: this.options.processRunners?.claude,
        }).canResume(nativeCheckpoint);
      default:
        return false;
    }
  }

  async execute(
    lease: RunnerLease,
    context: Parameters<RunnerExecutor["execute"]>[1],
  ): ReturnType<RunnerExecutor["execute"]> {
    const scenario = validateLocalWorkload(lease);
    const harnessId = validateTarget(lease, this.options.inventory);
    const baseHarness = await this.harnessFor(lease, context, harnessId);
    const harness = this.withMcpProfiles(lease, baseHarness);
    const workspaceRoot = join(this.root, "workspaces");
    const artifactRoot = join(this.root, "artifacts");
    const spoolRoot = join(this.root, "spools");
    await Promise.all(
      [workspaceRoot, artifactRoot, spoolRoot].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    );
    await Promise.all(
      [workspaceRoot, artifactRoot, spoolRoot].map((path) =>
        chmod(path, 0o700),
      ),
    );
    const artifactStore = new FileArtifactStore(artifactRoot);
    const eventSpool = new StreamingEventSpool(
      join(spoolRoot, `${lease.attemptId}.jsonl`),
      (event) => context.emit(event),
    );
    const result = await executeAgenticTask({
      jobId: lease.jobId,
      scenario,
      harness,
      limits: lease.execution.limits,
      artifactStore,
      eventSpool,
      workspaceRoot,
      cancel: context.signal,
      deadline: this.options.deadline,
    });
    return {
      status: normalizeStatus(result.status),
      observations: result.observations,
      artifacts: [
        {
          kind: "diff",
          blobPath: `attempts/${lease.attemptId}/${result.diffArtifact.id}.patch`,
          contentHash: result.diffArtifact.contentHash,
          byteLength: result.diffArtifact.byteSize,
        },
      ],
      error:
        result.status === "failed" || result.status === "timed_out"
          ? { kind: result.status }
          : null,
    };
  }

  private async harnessFor(
    lease: RunnerLease,
    context: Parameters<RunnerExecutor["execute"]>[1],
    harnessId: string,
  ): Promise<FixtureHarness> {
    if (lease.execution.target.plugin !== undefined) {
      return this.pluginHarness(lease, context, lease.execution.target.plugin);
    }
    switch (harnessId) {
      case "llmbench":
        return this.llmBenchHarness(lease);
      case "codex":
        return processFixtureHarness(
          lease,
          context,
          new CodexHarness({
            manifest: lease.execution.target.harness,
            runner: this.options.processRunners?.codex,
          }),
        );
      case "claude":
        return processFixtureHarness(
          lease,
          context,
          new ClaudeHarness({
            manifest: lease.execution.target.harness,
            runner: this.options.processRunners?.claude,
          }),
        );
      case "pi": {
        // Keep the real adapter as the source of the compatibility error while
        // invoking only its pure command validation, before any process starts.
        const adapter = new PiHarness({
          manifest: lease.execution.target.harness,
          runner: this.options.processRunners?.pi,
        });
        adapter.command(adapterRequest(lease, context, ""));
        throw new Error("PiHarness unexpectedly accepted an agentic task.");
      }
      /* v8 ignore start -- compatibility preflight rejects unknown non-plugin harnesses before dispatch. */
      default:
        throw new Error(`Unsupported harness: ${harnessId}`);
      /* v8 ignore stop */
    }
  }

  private async pluginHarness(
    lease: RunnerLease,
    context: Parameters<RunnerExecutor["execute"]>[1],
    selected: PluginExecutionRef,
  ): Promise<McpAwareFixtureHarness> {
    const registry = this.options.pluginRegistry;
    if (registry === undefined) {
      throw new Error("Runner plugin registry is unavailable.");
    }
    const execution = await registry.resolveExecution(
      lease.execution.target.harness.id,
    );
    if (
      execution.protocolVersion !== selected.protocolVersion ||
      execution.contentHash !== selected.contentHash
    ) {
      throw new Error(
        `Plugin ${lease.execution.target.harness.id} no longer matches the leased immutable identity. Reinstall or refresh the runner.`,
      );
    }
    const credentials: Record<string, string> = {};
    for (const [pluginName, runnerName] of Object.entries(
      execution.credentialGrants,
    )) {
      const value = await this.options.resolvePluginCredential?.(runnerName);
      if (value === undefined) {
        throw new Error(
          `Plugin credential grant '${runnerName}' for ${pluginName} could not be resolved.`,
        );
      }
      credentials[pluginName] = value;
    }
    const plugin = new ExecutablePluginHarness(
      {
        argv: execution.argv,
        protocolVersion: execution.protocolVersion,
        manifest: lease.execution.target.harness,
      },
      { runner: this.options.pluginProcessRunner },
    );
    const repairWithMcp: McpAwareFixtureHarness["repairWithMcp"] = async (
      { workspace, signal },
      mcpConnections,
    ) => {
      const result = await plugin.run(
        adapterRequest(lease, { ...context, signal }, workspace.root),
        { attemptId: lease.attemptId, credentials, mcpConnections },
      );
      if (
        result.checkpoint !== null &&
        !isDeepStrictEqual(result.checkpoint, context.checkpoint)
      ) {
        const { jobId: _jobId, ...checkpoint } = result.checkpoint;
        await context.saveCheckpoint(checkpoint);
      }
      if (result.status !== "completed") {
        throw new Error(
          result.error ?? `Plugin ${lease.execution.target.harness.id} failed.`,
        );
      }
      return { trajectory: [result.output] };
    };
    return {
      repair: (request) => repairWithMcp(request, []),
      repairWithMcp,
    };
  }

  private withMcpProfiles(
    lease: RunnerLease,
    harness: FixtureHarness,
  ): FixtureHarness {
    const selected = lease.execution.target.toolset.mcpProfiles;
    if (selected.length === 0) return harness;
    if (!isMcpAwareHarness(harness)) {
      throw new Error(
        `Harness ${lease.execution.target.harness.id} cannot consume runner-managed MCP connections.`,
      );
    }
    return {
      repair: async (request) => {
        const registry = this.options.mcpRegistry;
        if (registry === undefined) {
          throw new Error("Runner MCP profile registry is unavailable.");
        }
        const sessions: McpSessionHandle[] = [];
        const bridges: McpUnixBridge[] = [];
        const connections: PluginMcpConnection[] = [];
        const bridgeRoot = mcpBridgeRoot(this.root, lease.attemptId);
        let primaryError: unknown;
        let executionFailed = false;
        let outcome: Awaited<ReturnType<FixtureHarness["repair"]>> | undefined;
        try {
          for (const [index, reference] of selected.entries()) {
            const profile = await registry.get(reference.id);
            if (
              profile.metadata.version !== reference.version ||
              profile.metadata.contentHash !== reference.contentHash
            ) {
              throw new Error(
                `MCP profile ${reference.id} no longer matches the leased immutable identity.`,
              );
            }
            const session = await (this.options.startMcp ?? startMcpSession)(
              profile,
              this.options.resolveMcpSecret ??
                (() => Promise.resolve(undefined)),
              { signal: request.signal },
            );
            sessions.push(session);
            await session.probe(request.signal);
            const bridge = await (
              this.options.startMcpBridge ?? startMcpUnixBridge
            )(session, {
              root: bridgeRoot,
              socketName: `${String(index)}.sock`,
            });
            bridges.push(bridge);
            connections.push({
              profile: {
                id: reference.id,
                version: reference.version,
                contentHash: reference.contentHash,
              },
              transport: "unix",
              socketPath: bridge.socketPath,
            });
          }
          outcome = await harness.repairWithMcp(request, connections);
        } catch (error) {
          primaryError = error;
          executionFailed = true;
        }
        const cleanupErrors: unknown[] = [];
        for (const bridge of bridges.reverse()) {
          try {
            await bridge.stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        for (const session of sessions.reverse()) {
          try {
            await session.stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          await rm(bridgeRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
        if (cleanupErrors.length > 0) {
          const cleanup = new AggregateError(
            cleanupErrors,
            `MCP cleanup failed: ${cleanupErrors.map(describeCleanupError).join("; ")}`,
          );
          if (primaryError instanceof Error) {
            primaryError.message = `${primaryError.message}; ${cleanup.message}`;
          } else if (executionFailed) {
            primaryError = new AggregateError(
              [primaryError, ...cleanupErrors],
              `MCP execution failed: ${String(primaryError)}; ${cleanup.message}`,
            );
          } else {
            throw cleanup;
          }
        }
        if (executionFailed) throw primaryError;
        if (outcome === undefined) {
          throw new Error("MCP execution did not produce an outcome.");
        }
        return outcome;
      },
    };
  }

  private async llmBenchHarness(lease: RunnerLease): Promise<FixtureHarness> {
    const credential = lease.execution.credential;
    if (credential === null) {
      throw new Error(
        "LLMBench requires a runner-bound OpenRouter credential.",
      );
    }
    if (credential.provider !== "openrouter") {
      throw new Error(
        `LLMBench does not support credential provider: ${credential.provider}`,
      );
    }
    if (this.options.identity === undefined) {
      throw new Error(
        "Runner identity is required to open an LLMBench credential.",
      );
    }
    const resolver = new CredentialResolver(this.options.identity, {
      openrouter: credential.sealed,
    });
    const secret = await resolver.resolve("openrouter");
    assertOpenRouterCredential(secret.reveal());
    const provider = new OpenRouterProvider({
      apiKey: secret,
      fetch: this.options.openRouterFetch,
    });
    const boundedProvider: HarnessProvider = {
      complete: (request, options) =>
        provider.complete(
          { ...request, maxTokens: lease.execution.limits.maxTokens },
          options,
        ),
    };

    return {
      repair: async ({ workspace, signal }) => {
        const tools = createRepositoryTools(workspace.root, {
          maxReadBytes: 64 * 1024,
          maxSearchResults: 50,
        });
        const run = await new LlmBenchHarness({
          provider: boundedProvider,
          model: lease.execution.target.modelRoute.model,
          tools,
          root: workspace.root,
          signal,
          secrets: [secret.reveal()],
          limits: {
            maxDurationMs: lease.execution.limits.maxDurationMs,
            maxToolCalls: lease.execution.limits.maxToolCalls,
            maxTurns: lease.execution.limits.maxTurns,
          },
        }).run({ messages: [{ role: "user", content: taskPrompt(lease) }] });
        if (run.status !== "completed") {
          throw new Error(run.error ?? `LLMBench stopped with ${run.status}.`);
        }
        return {
          trajectory: run.events.map((event) =>
            event.type === "stop" ? `stop:${event.reason}` : event.type,
          ),
        };
      },
    };
  }
}

function describeCleanupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMcpAwareHarness(
  harness: FixtureHarness,
): harness is McpAwareFixtureHarness {
  return (
    "repairWithMcp" in harness && typeof harness.repairWithMcp === "function"
  );
}

function mcpBridgeRoot(root: string, attemptId: string): string {
  const jobKey = createHash("sha256")
    .update(attemptId)
    .digest("hex")
    .slice(0, 16);
  return join(root, "mcp", jobKey);
}

function assertOpenRouterCredential(value: string): void {
  if (!openRouterCredential.test(value)) {
    throw new Error("OpenRouter credential is malformed.");
  }
}

class StreamingEventSpool extends JsonlEventSpool {
  constructor(
    filePath: string,
    private readonly emit: (event: BenchmarkEvent) => Promise<void>,
  ) {
    super(filePath);
  }

  override async append(event: BenchmarkEvent): Promise<void> {
    await super.append(event);
    await this.emit(event);
  }
}

function validateLocalWorkload(
  lease: RunnerLease,
): ReturnType<typeof repairScenario> {
  if (lease.benchmark.id !== "repository-repair") {
    throw new Error(`Unsupported benchmark: ${lease.benchmark.id}`);
  }
  const fixtureId = lease.execution.workload.task.id as RepairFixtureId;
  const fixture = repairFixture(fixtureId);
  const scenario = repairScenario(fixtureId);
  if (lease.benchmark.version !== scenario.benchmark.manifest.version) {
    throw new Error(
      `Unsupported repository-repair benchmark version: ${lease.benchmark.version}`,
    );
  }
  if (!isDeepStrictEqual(lease.execution.workload.task, scenario.task)) {
    throw new Error(
      `Leased task ${fixtureId} does not match the local fixture task.`,
    );
  }
  if (lease.execution.workload.fixtureContentHash !== fixture.contentHash) {
    throw new Error(
      `Local fixture content hash mismatch for ${fixtureId}; refresh the runner corpus.`,
    );
  }
  if (lease.execution.workload.graderHash !== fixture.graderHash) {
    throw new Error(
      `Local grader hash mismatch for ${fixtureId}; refresh the runner corpus.`,
    );
  }
  return scenario;
}

function validateTarget(
  lease: RunnerLease,
  inventory?: RunnerInventory,
): string {
  const [blocker] = targetCompatibilityBlockers(
    lease.execution.target,
    REPOSITORY_REPAIR_REQUIRED_CAPABILITIES,
    LLMBENCH_REPOSITORY_TOOLS,
    undefined,
    inventory,
  );
  if (blocker) throw new Error(blocker);
  return lease.execution.target.harness.id;
}

function processFixtureHarness(
  lease: RunnerLease,
  context: Parameters<RunnerExecutor["execute"]>[1],
  adapter: CodexHarness | ClaudeHarness,
): FixtureHarness {
  return {
    repair: async ({ workspace, signal }) => {
      const result = await adapter.run(
        adapterRequest(lease, { ...context, signal }, workspace.root),
      );
      if (result.status !== "completed") {
        throw new Error(result.error ?? `${adapter.manifest.id} failed.`);
      }
      if (
        result.checkpoint !== null &&
        !isDeepStrictEqual(result.checkpoint, context.checkpoint)
      ) {
        const { jobId: _jobId, ...checkpoint } = result.checkpoint;
        await context.saveCheckpoint(checkpoint);
      }
      return { trajectory: [result.output] };
    },
  };
}

function adapterRequest(
  lease: RunnerLease,
  context: Parameters<RunnerExecutor["execute"]>[1],
  workspaceRoot: string,
): AdapterRunRequest {
  return {
    mode: "agentic",
    jobId: lease.jobId,
    caseId: lease.execution.workload.task.id,
    prompt: taskPrompt(lease),
    workspaceRoot,
    benchmark: lease.benchmark,
    modelRouteId: lease.execution.target.modelRoute.id,
    toolset: lease.execution.target.toolset,
    limits: lease.execution.limits,
    checkpoint:
      context.checkpoint === null
        ? null
        : checkpointFor(lease, context.checkpoint),
    signal: context.signal,
  };
}

function checkpointFor(
  lease: RunnerLease,
  checkpoint: RunnerCheckpoint,
): Checkpoint {
  return { jobId: lease.jobId, ...checkpoint };
}

function taskPrompt(lease: RunnerLease): string {
  const fixture = repairFixture(
    lease.execution.workload.task.id as RepairFixtureId,
  );
  return [
    `Repair repository task ${fixture.id}.`,
    `Language: ${fixture.language}.`,
    fixture.visibleSpec,
    "Constraints:",
    ...lease.execution.workload.task.constraints.map((item) => `- ${item}`),
    "Modify only files inside the provided workspace and finish when the repair is complete.",
  ].join("\n");
}

function normalizeStatus(
  status: "completed" | "failed" | "cancelled" | "timed_out",
): "completed" | "failed" | "cancelled" {
  return status === "timed_out" ? "failed" : status;
}
