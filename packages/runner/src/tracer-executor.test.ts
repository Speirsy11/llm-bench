import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BenchmarkEvent, RunnerLease } from "@llm-bench/contracts";
import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "@llm-bench/process-harness";
import { generateRunnerKeyPair, sealCredential } from "@llm-bench/crypto";
import {
  DEFAULT_FIXTURE_ID,
  repairFixture,
  repairScenario,
} from "@llm-bench/repository-repair";

import { TracerExecutor } from "./tracer-executor";

const RUNNER_ID = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";
const OTHER_RUNNER_ID = "f4a6453c-cdd4-405b-9733-39af0f6d829e";

describe("TracerExecutor", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("selects LLMBench, opens its runner-bound credential, and uses the leased model, tools, task, and limits", async () => {
    const root = await temporaryRoot();
    const keys = await generateRunnerKeyPair();
    const identity = { runnerId: RUNNER_ID, ...keys };
    const secret = "sk-or-v1-executor-canary-1234";
    const credential = await sealCredential({
      runnerId: identity.runnerId,
      recipientPublicKey: identity.publicKey,
      secret,
    });
    const calls: { headers: Record<string, string>; body: unknown }[] = [];
    const fixture = repairFixture(DEFAULT_FIXTURE_ID);
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (typeof init.body !== "string") {
        throw new Error("Expected a JSON request body.");
      }
      const body: unknown = JSON.parse(init.body);
      calls.push({ headers, body });
      if (calls.length === 1) {
        return Promise.resolve(
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "patch-1",
                      function: {
                        name: "apply_patch",
                        arguments: JSON.stringify({
                          path: fixture.modulePath,
                          oldText: fixture.brokenSource,
                          newText: fixture.knownPatch,
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          choices: [{ message: { content: "Fixed." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      );
    });
    const lease = leaseFor("llmbench", {
      credential: {
        profileId: "4c3a4bb8-af7e-46bc-ad15-d6126aed8924",
        provider: "openrouter",
        sealed: credential,
      },
    });

    const result = await new TracerExecutor(root, {
      identity,
      openRouterFetch: fetch,
    }).execute(lease, context());

    expect(result).toMatchObject({
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${secret}`);
    expect(calls[0]?.body).toMatchObject({
      model: lease.execution.target.modelRoute.model,
      max_tokens: lease.execution.limits.maxTokens,
      tools: [
        { function: { name: "read_file" } },
        { function: { name: "list_directory" } },
        { function: { name: "search_files" } },
        { function: { name: "apply_patch" } },
      ],
    });
    expect(JSON.stringify(calls[0]?.body)).toContain(
      lease.execution.workload.task.id,
    );
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain(
      secret,
    );
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects malformed OpenRouter plaintext before provider transport", async () => {
    const root = await temporaryRoot();
    const keys = await generateRunnerKeyPair();
    const identity = { runnerId: RUNNER_ID, ...keys };
    const fetch = vi.fn();
    const sealed = await sealCredential({
      runnerId: identity.runnerId,
      recipientPublicKey: identity.publicKey,
      secret: "sk-or-v1-                ",
    });

    await expect(
      new TracerExecutor(root, {
        identity,
        openRouterFetch: fetch,
      }).execute(
        leaseFor("llmbench", {
          credential: {
            profileId: "4c3a4bb8-af7e-46bc-ad15-d6126aed8924",
            provider: "openrouter",
            sealed,
          },
        }),
        context(),
      ),
    ).rejects.toThrow("OpenRouter credential is malformed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["codex", "claude"] as const)(
    "passes the selected task and model to %s native auth without opening ciphertext",
    async (harnessId) => {
      const root = await temporaryRoot();
      const wrongKeys = await generateRunnerKeyPair();
      const sealed = await sealCredential({
        runnerId: OTHER_RUNNER_ID,
        recipientPublicKey: wrongKeys.publicKey,
        secret: "must-never-be-opened",
      });
      const process = new RepairProcessRunner(harnessId);
      const lease = leaseFor(harnessId, {
        credential: {
          profileId: "4c3a4bb8-af7e-46bc-ad15-d6126aed8924",
          provider: "openrouter",
          sealed,
        },
      });

      const result = await new TracerExecutor(root, {
        processRunners: { [harnessId]: process },
      }).execute(lease, context());

      expect(result.status).toBe("completed");
      expect(process.requests).toHaveLength(1);
      const request = process.requests[0];
      expect(request?.argv).toContain(lease.execution.target.modelRoute.model);
      expect(request?.stdin).toContain(lease.execution.workload.task.id);
      expect(JSON.stringify(request)).not.toContain(sealed.ciphertext);
      expect(JSON.stringify(request)).not.toContain("must-never-be-opened");
    },
  );

  it.each(["codex", "claude"] as const)(
    "persists the %s native checkpoint through the runner execution context",
    async (harnessId) => {
      const root = await temporaryRoot();
      const checkpoints: RunnerLease["checkpoint"][] = [];
      const lease = leaseFor(harnessId);
      const process = new RepairProcessRunner(harnessId);

      await new TracerExecutor(root, {
        processRunners: { [harnessId]: process },
      }).execute(lease, {
        ...context(),
        saveCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint);
          return Promise.resolve();
        },
      });

      expect(checkpoints).toEqual([
        {
          sequence: 0,
          resumable: true,
          state:
            harnessId === "codex"
              ? { threadId: "thread-1" }
              : { sessionId: "session-1" },
        },
      ]);

      const checkpoint = checkpoints[0];
      if (checkpoint === null || checkpoint === undefined) {
        throw new Error("Expected a native checkpoint.");
      }
      const resumedProcess = new RepairProcessRunner(harnessId);
      await new TracerExecutor(root, {
        processRunners: { [harnessId]: resumedProcess },
      }).execute(
        { ...lease, attemptId: "333e1acf-9fc1-461c-af4b-8d00dd79a1c3" },
        {
          ...context(checkpoint),
          saveCheckpoint: (value) => {
            checkpoints.push(value);
            return Promise.resolve();
          },
        },
      );

      expect(resumedProcess.requests[0]?.argv).toContain(
        harnessId === "codex" ? "resume" : "--resume",
      );
      expect(checkpoints[1]).toMatchObject({ sequence: 1, resumable: true });
    },
  );

  it("rejects local fixture or grader drift before a provider or process starts", async () => {
    const root = await temporaryRoot();
    const process = new RepairProcessRunner("codex");
    const fetch = vi.fn();
    const lease = leaseFor("codex");
    lease.execution.workload.fixtureContentHash = "0".repeat(64);

    await expect(
      new TracerExecutor(root, {
        openRouterFetch: fetch,
        processRunners: { codex: process },
      }).execute(lease, context()),
    ).rejects.toThrow("fixture content hash");
    expect(process.requests).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();

    const graderLease = leaseFor("llmbench");
    graderLease.execution.workload.graderHash = "0".repeat(64);
    await expect(
      new TracerExecutor(root, { openRouterFetch: fetch }).execute(
        graderLease,
        context(),
      ),
    ).rejects.toThrow("grader hash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects Pi agentic work before starting a process", async () => {
    const root = await temporaryRoot();
    const process = new RepairProcessRunner("pi");
    await expect(
      new TracerExecutor(root, { processRunners: { pi: process } }).execute(
        leaseFor("pi"),
        context(),
      ),
    ).rejects.toThrow("PiHarness only supports response mode");
    expect(process.requests).toHaveLength(0);
  });

  it("makes resume decisions for the selected target", async () => {
    const executor = new TracerExecutor(await temporaryRoot());
    expect(
      executor.canResume(leaseFor("codex"), {
        sequence: 1,
        resumable: true,
        state: { threadId: "thread-1" },
      }),
    ).toBe(true);
    expect(
      executor.canResume(leaseFor("claude"), {
        sequence: 1,
        resumable: true,
        state: { sessionId: "session-1" },
      }),
    ).toBe(true);
    expect(
      executor.canResume(leaseFor("llmbench"), {
        sequence: 1,
        resumable: true,
        state: {},
      }),
    ).toBe(false);
    expect(
      executor.canResume(leaseFor("pi"), {
        sequence: 1,
        resumable: true,
        state: {},
      }),
    ).toBe(false);

    const process = new RepairProcessRunner("codex");
    expect(
      new TracerExecutor(await temporaryRoot(), {
        processRunners: { codex: process, claude: process },
      }).canResume(leaseFor("codex"), {
        sequence: 1,
        resumable: true,
        state: { threadId: "thread-1" },
      }),
    ).toBe(true);
    expect(
      new TracerExecutor(await temporaryRoot(), {
        processRunners: { codex: process, claude: process },
      }).canResume(leaseFor("claude"), {
        sequence: 1,
        resumable: true,
        state: { sessionId: "session-1" },
      }),
    ).toBe(true);
  });

  it("rejects undeclared routes and incompatible harness or toolset contracts before process start", async () => {
    const root = await temporaryRoot();
    const process = new RepairProcessRunner("codex");
    const cases: [RunnerLease, string][] = [];
    const missingRoute = leaseFor("codex");
    missingRoute.execution.target.harness.modelRoutes = [];
    cases.push([missingRoute, "is not declared"]);
    const wrongProvider = leaseFor("codex");
    wrongProvider.execution.target.harness.modelRoutes = [
      { ...wrongProvider.execution.target.modelRoute, provider: "other" },
    ];
    cases.push([wrongProvider, "is not declared"]);
    const wrongModel = leaseFor("codex");
    wrongModel.execution.target.harness.modelRoutes = [
      { ...wrongModel.execution.target.modelRoute, model: "other" },
    ];
    cases.push([wrongModel, "is not declared"]);
    const capability = leaseFor("codex");
    capability.execution.target.harness.capabilities = [
      "response_generation",
      "workspaces",
    ];
    cases.push([capability, "lacks required capability files"]);
    const harnessVersion = leaseFor("codex");
    harnessVersion.execution.target.harness.version = "2.0.0";
    cases.push([harnessVersion, "version 2.0.0 is unsupported"]);
    const nativeToolset = leaseFor("codex");
    nativeToolset.execution.target.toolset.id = "builtin";
    cases.push([nativeToolset, "requires native toolset 1.0.0"]);
    const nativeTools = leaseFor("codex");
    nativeTools.execution.target.toolset.tools = ["read_file"];
    cases.push([nativeTools, "cannot receive runner-managed tools"]);

    for (const [lease, message] of cases) {
      await expect(
        new TracerExecutor(root, {
          processRunners: { codex: process },
        }).execute(lease, context()),
      ).rejects.toThrow(message);
    }
    expect(process.requests).toHaveLength(0);
  });

  it("fails closed for unsupported benchmark, version, task, and harness selections", async () => {
    const root = await temporaryRoot();
    const cases: [RunnerLease, string][] = [];
    const benchmark = leaseFor("codex");
    benchmark.benchmark.id = "unknown";
    cases.push([benchmark, "Unsupported benchmark"]);
    const version = leaseFor("codex");
    version.benchmark.version = "9.0.0";
    cases.push([version, "Unsupported repository-repair benchmark version"]);
    const task = leaseFor("codex");
    task.execution.workload.task.constraints = ["different"];
    cases.push([task, "does not match the local fixture task"]);
    const harness = leaseFor("codex");
    harness.execution.target.harness.id = "unknown";
    cases.push([harness, "Harness unknown is unsupported."]);

    for (const [lease, message] of cases) {
      await expect(
        new TracerExecutor(root).execute(lease, context()),
      ).rejects.toThrow(message);
    }
  });

  it("fails closed for invalid LLMBench target configuration before provider use", async () => {
    const root = await temporaryRoot();
    const { identity, credential } = await llmCredential();
    const cases: [RunnerLease, TracerExecutor, string][] = [];
    cases.push([
      leaseFor("llmbench"),
      new TracerExecutor(root, { identity }),
      "requires a runner-bound OpenRouter credential",
    ]);
    const provider = leaseFor("llmbench", {
      credential: { ...credential },
    });
    if (provider.execution.credential === null) {
      throw new Error("Expected the credential fixture.");
    }
    provider.execution.credential.provider = "other";
    cases.push([
      provider,
      new TracerExecutor(root, { identity }),
      "does not support credential provider",
    ]);
    const route = leaseFor("llmbench", { credential: { ...credential } });
    route.execution.target.modelRoute.provider = "other";
    cases.push([
      route,
      new TracerExecutor(root, { identity }),
      "requires an OpenRouter model route",
    ]);
    cases.push([
      leaseFor("llmbench", { credential: { ...credential } }),
      new TracerExecutor(root),
      "Runner identity is required",
    ]);
    const mcp = leaseFor("llmbench", { credential: { ...credential } });
    mcp.execution.target.toolset.mcpProfiles = ["fixture"];
    cases.push([mcp, new TracerExecutor(root, { identity }), "MCP profiles"]);

    for (const [lease, executor, message] of cases) {
      await expect(executor.execute(lease, context())).rejects.toThrow(message);
    }
  });

  it("reports selected harness failures, timeouts, and unsupported repository tools", async () => {
    const root = await temporaryRoot();
    const failed = await new TracerExecutor(root, {
      processRunners: { codex: new RepairProcessRunner("codex", "failed") },
    }).execute(leaseFor("codex"), context());
    expect(failed).toMatchObject({
      status: "failed",
      error: { kind: "failed" },
    });

    const cancelled = await new TracerExecutor(root, {
      processRunners: {
        codex: new RepairProcessRunner("codex", "cancelled"),
      },
    }).execute(
      {
        ...leaseFor("codex"),
        attemptId: "7c0291ca-26bf-4c16-9544-edf1dd73053a",
      },
      context(),
    );
    expect(cancelled.status).toBe("failed");

    const timedOut = await new TracerExecutor(root, {
      processRunners: { codex: new RepairProcessRunner("codex") },
      deadline: AbortSignal.abort(),
    }).execute(
      {
        ...leaseFor("codex"),
        attemptId: "352ff11a-3787-4031-ae49-a6ba97056411",
      },
      context({
        sequence: 1,
        resumable: true,
        state: { threadId: "thread-1" },
      }),
    );
    expect(timedOut).toMatchObject({
      status: "failed",
      error: { kind: "timed_out" },
    });

    const { identity, credential } = await llmCredential();
    const unsupportedTool = leaseFor("llmbench", {
      credential: { ...credential },
    });
    unsupportedTool.execution.target.toolset.tools = ["unknown"];
    await expect(
      new TracerExecutor(root, { identity }).execute(
        {
          ...unsupportedTool,
          attemptId: "ad38e871-8dbe-49af-a9dd-bc099e726c11",
        },
        context(),
      ),
    ).rejects.toThrow("requires builtin toolset");
  });

  it("turns provider errors and bounded stops into failed LLMBench runs", async () => {
    const root = await temporaryRoot();
    const { identity, credential } = await llmCredential();
    const providerFailure = await new TracerExecutor(root, {
      identity,
      openRouterFetch: () =>
        Promise.resolve(new Response("failure", { status: 500 })),
    }).execute(leaseFor("llmbench", { credential }), context());
    expect(providerFailure.status).toBe("failed");

    const bounded = leaseFor("llmbench", { credential });
    bounded.attemptId = "160236e1-5e8c-43fe-8048-8788ea19e17d";
    bounded.execution.limits.maxTurns = 1;
    const boundedStop = await new TracerExecutor(root, {
      identity,
      openRouterFetch: () =>
        Promise.resolve(
          jsonResponse({
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "read-1",
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "SPEC.md" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        ),
    }).execute(bounded, context());
    expect(boundedStop.status).toBe("failed");
  });

  it("emits durable progress before the harness completes without replaying events", async () => {
    const root = await temporaryRoot();
    const { identity, credential } = await llmCredential();
    let releaseFetch: ((response: Response) => void) | undefined;
    const fetchResponse = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    const events: BenchmarkEvent[] = [];
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const execution = new TracerExecutor(root, {
      identity,
      openRouterFetch: () => fetchResponse,
    }).execute(leaseFor("llmbench", { credential }), {
      signal: new AbortController().signal,
      checkpoint: null,
      saveCheckpoint: () => Promise.resolve(),
      emit: (event) => {
        events.push(event);
        if (event.type === "job_started") resolveStarted?.();
        return Promise.resolve();
      },
    });

    await started;
    expect(events.map((event) => event.type)).toEqual(["job_started"]);
    releaseFetch?.(
      jsonResponse({
        choices: [{ message: { content: "Done." }, finish_reason: "stop" }],
      }),
    );
    await execution;
    expect(events.map((event) => event.type)).toEqual([
      "job_started",
      "case_completed",
    ]);
  });

  it("fails execution when the worker cannot durably capture progress", async () => {
    const root = await temporaryRoot();
    const process = new RepairProcessRunner("codex");
    const lease = {
      ...leaseFor("codex"),
      attemptId: "69508413-fac2-4c35-9219-306676b824ed",
    };

    await expect(
      new TracerExecutor(root, {
        processRunners: { codex: process },
      }).execute(lease, {
        signal: new AbortController().signal,
        checkpoint: null,
        saveCheckpoint: () => Promise.resolve(),
        emit: () => Promise.reject(new Error("durable spool unavailable")),
      }),
    ).rejects.toThrow("durable spool unavailable");

    expect(process.requests).toHaveLength(0);
    const persisted = (
      await readFile(join(root, "spools", `${lease.attemptId}.jsonl`), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as BenchmarkEvent);
    expect(persisted.map((event) => event.type)).toEqual(["job_started"]);
  });

  it("waits for durable progress capture before starting the provider", async () => {
    const root = await temporaryRoot();
    const { identity, credential } = await llmCredential();
    const lease = {
      ...leaseFor("llmbench", { credential }),
      attemptId: "449ea33a-7030-4717-b63c-91264a8ec494",
    };
    let providerStarted = false;
    let releaseDurability: (() => void) | undefined;
    const blockedDurability = new Promise<void>((resolve) => {
      releaseDurability = resolve;
    });
    let captured = 0;

    const execution = new TracerExecutor(root, {
      identity,
      openRouterFetch: () => {
        providerStarted = true;
        return Promise.resolve(
          jsonResponse({
            choices: [{ message: { content: "Done." }, finish_reason: "stop" }],
          }),
        );
      },
    }).execute(lease, {
      signal: new AbortController().signal,
      checkpoint: null,
      saveCheckpoint: () => Promise.resolve(),
      emit: () => {
        captured += 1;
        return captured === 1 ? blockedDurability : Promise.resolve();
      },
    });

    await vi.waitFor(() => expect(captured).toBe(1));
    expect(providerStarted).toBe(false);
    releaseDurability?.();
    await expect(execution).resolves.toMatchObject({ status: "completed" });
    expect(providerStarted).toBe(true);
    const persisted = (
      await readFile(join(root, "spools", `${lease.attemptId}.jsonl`), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as BenchmarkEvent);
    expect(persisted.map((event) => event.type)).toEqual([
      "job_started",
      "case_completed",
    ]);
  });

  it("hardens runner directories", async () => {
    const root = await temporaryRoot();
    const process = new RepairProcessRunner("codex");
    await new TracerExecutor(root, {
      processRunners: { codex: process },
    }).execute(leaseFor("codex"), context());
    for (const name of ["workspaces", "artifacts", "spools"]) {
      expect((await stat(join(root, name))).mode & 0o777).toBe(0o700);
      await chmod(join(root, name), 0o700);
    }
  });

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-executor-"));
    roots.push(root);
    return root;
  }
});

function leaseFor(
  harnessId: "llmbench" | "codex" | "claude" | "pi",
  overrides: Partial<RunnerLease["execution"]> = {},
): RunnerLease {
  const fixture = repairFixture(DEFAULT_FIXTURE_ID);
  const scenario = repairScenario(DEFAULT_FIXTURE_ID);
  const modelRoute = {
    id: `${harnessId}-model`,
    provider: harnessId === "llmbench" ? "openrouter" : harnessId,
    model:
      harnessId === "llmbench" ? "openai/gpt-5-mini" : `${harnessId}-model-v1`,
  };
  const execution: RunnerLease["execution"] = {
    workload: {
      kind: "agentic",
      task: scenario.task,
      fixtureContentHash: fixture.contentHash,
      graderHash: fixture.graderHash,
    },
    target: {
      modelRoute,
      harness: {
        id: harnessId,
        version: "1.0.0",
        capabilities: [
          "response_generation",
          "workspaces",
          "files",
          ...(harnessId === "codex" || harnessId === "claude"
            ? (["session_resume"] as const)
            : []),
        ],
        modelRoutes: [modelRoute],
      },
      toolset: {
        id: harnessId === "llmbench" ? "builtin" : "native",
        version: "1.0.0",
        tools:
          harnessId === "llmbench"
            ? ["read_file", "list_directory", "search_files", "apply_patch"]
            : [],
        mcpProfiles: [],
      },
    },
    limits: {
      maxDurationMs: 10_000,
      maxToolCalls: 4,
      maxTokens: 321,
      maxTurns: 3,
    },
    credential: null,
    ...overrides,
  };
  return {
    jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
    attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
    leaseToken: "lease-token",
    benchmark: { id: "repository-repair", version: "1.0.0" },
    execution,
    queuePosition: 0,
    checkpoint: null,
    cancellationRequested: false,
  };
}

function context(checkpoint: RunnerLease["checkpoint"] = null) {
  return {
    signal: new AbortController().signal,
    checkpoint,
    emit: () => Promise.resolve(),
    saveCheckpoint: () => Promise.resolve(),
  };
}

async function llmCredential() {
  const keys = await generateRunnerKeyPair();
  const identity = { runnerId: RUNNER_ID, ...keys };
  return {
    identity,
    credential: {
      profileId: "4c3a4bb8-af7e-46bc-ad15-d6126aed8924",
      provider: "openrouter",
      sealed: await sealCredential({
        runnerId: identity.runnerId,
        recipientPublicKey: identity.publicKey,
        secret: "sk-or-v1-fixture-credential-1234",
      }),
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

class RepairProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];

  constructor(
    private readonly harness: "codex" | "claude" | "pi",
    private readonly outcome: "success" | "failed" | "cancelled" = "success",
  ) {}

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const fixture = repairFixture(DEFAULT_FIXTURE_ID);
    await writeFile(join(request.cwd, fixture.modulePath), fixture.knownPatch);
    return {
      exitCode: this.outcome === "failed" ? 1 : 0,
      signal: null,
      stdoutLines:
        this.harness === "codex"
          ? [
              JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
              JSON.stringify({
                type: "item.completed",
                item: { id: "item-1", type: "agent_message", text: "Fixed." },
              }),
              JSON.stringify({
                type: "turn.completed",
                usage: {
                  input_tokens: 1,
                  cached_input_tokens: 0,
                  output_tokens: 1,
                  reasoning_output_tokens: 0,
                },
              }),
            ]
          : [
              JSON.stringify({
                type: "assistant",
                message: {
                  id: "msg-1",
                  type: "message",
                  role: "assistant",
                  content: [{ type: "text", text: "Fixed." }],
                  model: "claude-model-v1",
                  stop_reason: "end_turn",
                  stop_sequence: null,
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
                session_id: "session-1",
              }),
            ],
      stderr: "",
      outputBytes: 1,
      cancelled: this.outcome === "cancelled",
    };
  }
}
