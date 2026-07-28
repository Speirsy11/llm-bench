import { createHash } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import type { PluginMcpConnection } from "@speirsy11/llm-bench-harness-sdk";

import type {
  AdapterRunRequest,
  AdapterRunResult,
  BenchmarkEvent,
  Checkpoint,
  PluginExecutionRef,
  ResponseBenchmark,
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
import { InstructionFollowingBenchmark } from "@llm-bench/instruction-following";
import {
  createRepositoryTools,
  CredentialResolver,
  LlmBenchHarness,
} from "@llm-bench/llm-bench-harness";
import { startMcpSession, startMcpUnixBridge } from "@llm-bench/mcp";
import { OpenRouterProvider } from "@llm-bench/openai-compatible";
import { PerformanceBenchmark } from "@llm-bench/performance";
import { PiHarness } from "@llm-bench/pi-harness";
import { repairFixture, repairScenario } from "@llm-bench/repository-repair";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";
import { StructuredOutputBenchmark } from "@llm-bench/structured-output";

import type { PluginRegistry } from "./plugin-registry";
import type { RunnerExecutor } from "./worker";
import { ExecutablePluginHarness } from "./plugin-host";
import { executeResponseBenchmark } from "./response-executor";

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
  removeMcpBridgeRoot?: (path: string) => Promise<void>;
  deadline?: AbortSignal;
  now?: () => number;
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

type AgenticWorkload = Extract<
  RunnerLease["execution"]["workload"],
  { kind: "agentic" }
>;
type AgenticLease = Omit<RunnerLease, "execution"> & {
  execution: Omit<RunnerLease["execution"], "workload"> & {
    workload: AgenticWorkload;
  };
};
type ResponseWorkload = Extract<
  RunnerLease["execution"]["workload"],
  { kind: "response" }
>;
type ResponseLease = Omit<RunnerLease, "execution"> & {
  execution: Omit<RunnerLease["execution"], "workload"> & {
    workload: ResponseWorkload;
  };
};

/** Executes versioned repository-repair leases through their selected target. */
export class TracerExecutor implements RunnerExecutor {
  constructor(
    private readonly root: string,
    private readonly options: TracerExecutorOptions = {},
  ) {}

  canResume(lease: RunnerLease, checkpoint: RunnerCheckpoint): boolean {
    if (lease.execution.workload.kind === "response") {
      return false;
    }
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
    if (isResponseLease(lease)) {
      return this.executeResponse(lease, context);
    }
    const agenticLease = lease as AgenticLease;
    const scenario = validateLocalWorkload(agenticLease);
    const harnessId = validateTarget(agenticLease, this.options.inventory);
    const baseHarness = await this.harnessFor(agenticLease, context, harnessId);
    const harness = this.withMcpProfiles(agenticLease, baseHarness);
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
      join(spoolRoot, `${agenticLease.attemptId}.jsonl`),
      (event) => context.emit(event),
    );
    const result = await executeAgenticTask({
      jobId: agenticLease.jobId,
      scenario,
      harness,
      limits: agenticLease.execution.limits,
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
          blobPath: `attempts/${agenticLease.attemptId}/${result.diffArtifact.id}.patch`,
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

  private async executeResponse(
    lease: ResponseLease,
    context: Parameters<RunnerExecutor["execute"]>[1],
  ): ReturnType<RunnerExecutor["execute"]> {
    const { benchmark, responseCase } = validateResponseWorkload(lease);
    validateResponseTarget(lease, benchmark, this.options.inventory);
    if (lease.execution.target.plugin !== undefined) {
      throw new Error(
        "Response execution for local harness plugins is not supported.",
      );
    }
    if (lease.execution.target.toolset.mcpProfiles.length > 0) {
      throw new Error(
        "Response execution does not support runner-managed MCP profiles.",
      );
    }

    const artifactRoot = join(this.root, "artifacts");
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await chmod(artifactRoot, 0o700);
    const artifactStore = new FileArtifactStore(artifactRoot);
    const now = this.options.now ?? Date.now;
    await context.emit({
      type: "job_started",
      at: new Date(now()).toISOString(),
      jobId: lease.jobId,
    });

    try {
      const signal = responseRequestSignal(
        lease,
        context.signal,
        this.options.deadline,
      );
      const run =
        lease.execution.target.harness.id === "llmbench"
          ? await this.llmBenchResponseRunner(lease, signal)
          : (sample: { index: number }) =>
              this.runNativeResponseSample(lease, signal, sample.index);
      const result = await executeResponseBenchmark({
        benchmark,
        responseCase,
        now,
        run,
      });
      const evidence = await artifactStore.put({
        jobId: lease.jobId,
        mediaType: "application/vnd.llmbench.response-evidence+json",
        bytes: Buffer.from(JSON.stringify(result.evidence), "utf8"),
      });
      await context.emit({
        type: "case_completed",
        at: new Date(now()).toISOString(),
        caseId: responseCase.id,
        observations: result.observations,
      });
      return {
        status: "completed",
        observations: result.observations,
        artifacts: [
          {
            kind: "response_evidence",
            blobPath: `attempts/${lease.attemptId}/${evidence.id}.json`,
            contentHash: evidence.contentHash,
            byteLength: evidence.byteSize,
          },
        ],
        error: null,
      };
    } catch (error) {
      const message = describeCleanupError(error);
      await context.emit({
        type: "job_failed",
        at: new Date(now()).toISOString(),
        failure: { kind: "harness_error", message },
      });
      return {
        status: context.signal.aborted ? "cancelled" : "failed",
        observations: [],
        artifacts: [],
        error: { kind: "harness_error", message },
      };
    }
  }

  private async llmBenchResponseRunner(
    lease: ResponseLease,
    signal: AbortSignal,
  ): Promise<(sample: { index: number }) => Promise<AdapterRunResult>> {
    const { provider } = await this.openRouterProvider(lease);
    return async ({ index: sampleIndex }) => {
      const providerStartedAt = performance.now();
      const completion = await provider.complete(
        {
          model: lease.execution.target.modelRoute.model,
          messages: [
            {
              role: "user",
              content: lease.execution.workload.case.prompt,
            },
          ],
          maxTokens: lease.execution.limits.maxTokens,
        },
        { signal },
      );
      const providerDurationMs = performance.now() - providerStartedAt;
      return {
        status: "completed",
        output: completion.content,
        observations: [
          { metricId: "provider_duration_ms", value: providerDurationMs },
          { metricId: "input_tokens", value: completion.usage.promptTokens },
          {
            metricId: "output_tokens",
            value: completion.usage.completionTokens,
          },
        ],
        checkpoint: null,
        events: [],
        metadata: { model: completion.model, sampleIndex },
      };
    };
  }

  private runNativeResponseSample(
    lease: ResponseLease,
    signal: AbortSignal,
    _sampleIndex: number,
  ): Promise<AdapterRunResult> {
    const harnessId = lease.execution.target.harness.id;
    const adapter =
      harnessId === "codex"
        ? new CodexHarness({
            manifest: lease.execution.target.harness,
            runner: this.options.processRunners?.codex,
          })
        : harnessId === "claude"
          ? new ClaudeHarness({
              manifest: lease.execution.target.harness,
              runner: this.options.processRunners?.claude,
            })
          : new PiHarness({
              manifest: lease.execution.target.harness,
              runner: this.options.processRunners?.pi,
            });
    return adapter.run(responseAdapterRequest(lease, signal, this.root));
  }

  private async harnessFor(
    lease: AgenticLease,
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
    lease: AgenticLease,
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
    lease: AgenticLease,
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
        let outcome!: Awaited<ReturnType<FixtureHarness["repair"]>>;
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
          await (
            this.options.removeMcpBridgeRoot ??
            ((path) => rm(path, { recursive: true, force: true }))
          )(bridgeRoot);
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
        return outcome;
      },
    };
  }

  private async openRouterProvider(
    lease: RunnerLease,
  ): Promise<{ provider: OpenRouterProvider; secret: string }> {
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
    const resolved = await resolver.resolve("openrouter");
    const secret = resolved.reveal();
    assertOpenRouterCredential(secret);
    const provider = new OpenRouterProvider({
      apiKey: resolved,
      fetch: this.options.openRouterFetch,
    });
    return { provider, secret };
  }

  private async llmBenchHarness(lease: AgenticLease): Promise<FixtureHarness> {
    const { provider, secret } = await this.openRouterProvider(lease);
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
          secrets: [secret],
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
  lease: AgenticLease,
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

function isResponseLease(lease: RunnerLease): lease is ResponseLease {
  return lease.execution.workload.kind === "response";
}

function validateResponseWorkload(lease: ResponseLease): {
  benchmark: ResponseBenchmark;
  responseCase: ResponseWorkload["case"];
} {
  const benchmark: ResponseBenchmark =
    lease.benchmark.id === "structured-output"
      ? new StructuredOutputBenchmark()
      : lease.benchmark.id === "instruction-following"
        ? new InstructionFollowingBenchmark()
        : lease.benchmark.id === "performance"
          ? new PerformanceBenchmark()
          : (() => {
              throw new Error(`Unsupported benchmark: ${lease.benchmark.id}`);
            })();
  if (lease.benchmark.version !== benchmark.manifest.version) {
    throw new Error(
      `Unsupported ${benchmark.id} benchmark version: ${lease.benchmark.version}`,
    );
  }
  const responseCase = benchmark
    .cases()
    .find((candidate) => candidate.id === lease.execution.workload.case.id);
  if (
    responseCase === undefined ||
    !isDeepStrictEqual(responseCase, lease.execution.workload.case)
  ) {
    throw new Error(
      `Leased response case ${lease.execution.workload.case.id} does not match the local benchmark case.`,
    );
  }
  return { benchmark, responseCase };
}

function validateResponseTarget(
  lease: ResponseLease,
  benchmark: ResponseBenchmark,
  inventory?: RunnerInventory,
): void {
  const [blocker] = targetCompatibilityBlockers(
    lease.execution.target,
    benchmark.requiredCapabilities,
    lease.execution.target.toolset.tools,
    undefined,
    inventory,
  );
  if (blocker) throw new Error(blocker);
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
  lease: AgenticLease,
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

function responseRequestSignal(
  lease: ResponseLease,
  executionSignal: AbortSignal,
  deadline: AbortSignal | undefined,
): AbortSignal {
  return AbortSignal.any([
    executionSignal,
    ...(deadline === undefined ? [] : [deadline]),
    AbortSignal.timeout(lease.execution.limits.maxDurationMs),
  ]);
}

function adapterRequest(
  lease: AgenticLease,
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

function responseAdapterRequest(
  lease: ResponseLease,
  signal: AbortSignal,
  workspaceRoot: string,
): AdapterRunRequest {
  return {
    mode: "response",
    jobId: lease.jobId,
    caseId: lease.execution.workload.case.id,
    prompt: lease.execution.workload.case.prompt,
    workspaceRoot,
    benchmark: lease.benchmark,
    modelRouteId: lease.execution.target.modelRoute.id,
    toolset: lease.execution.target.toolset,
    limits: lease.execution.limits,
    checkpoint: null,
    signal,
  };
}

function checkpointFor(
  lease: RunnerLease,
  checkpoint: RunnerCheckpoint,
): Checkpoint {
  return { jobId: lease.jobId, ...checkpoint };
}

function taskPrompt(lease: AgenticLease): string {
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
