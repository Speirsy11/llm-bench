import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunnerLease } from "@llm-bench/contracts";

import { RunnerStateStore } from "./state";
import { runnerLeaseFixture } from "./test-fixture";
import { RunnerWorker } from "./worker";

const lease = runnerLeaseFixture();

describe("RunnerWorker", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("replays buffered progress after network loss without rerunning the job", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    let leaseAvailable = true;
    let offline = true;
    let executions = 0;
    const sequences: number[] = [];
    const completions: string[] = [];
    const transport = {
      lease: () => {
        if (!leaseAvailable) return Promise.resolve(null);
        leaseAvailable = false;
        return Promise.resolve(lease);
      },
      recordEvents: (_lease: RunnerLease, events: { sequence: number }[]) => {
        if (offline) return Promise.reject(new Error("network unavailable"));
        sequences.push(...events.map(({ sequence }) => sequence));
        return Promise.resolve({
          throughSequence: events.at(-1)?.sequence ?? -1,
        });
      },
      saveCheckpoint: () => Promise.resolve(),
      complete: (_lease: RunnerLease, terminal: { status: string }) => {
        completions.push(terminal.status);
        return Promise.resolve();
      },
      cancellationStatus: () =>
        Promise.resolve({ cancellationRequested: false }),
    };
    const executor = {
      canResume: () => false,
      execute: async (
        _lease: RunnerLease,
        context: { emit: (event: never) => Promise<void> },
      ) => {
        executions += 1;
        await context.emit({
          type: "job_started",
          at: "2026-07-01T10:00:00.000Z",
          jobId: lease.jobId,
        } as never);
        await context.emit({
          type: "case_completed",
          at: "2026-07-01T10:00:01.000Z",
          caseId: "clamp-bounds",
          observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
        } as never);
        return {
          status: "completed" as const,
          observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
          artifacts: [],
          error: null,
        };
      },
    };
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport,
      executor,
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    offline = false;
    await expect(worker.runOnce()).resolves.toBe("completed");

    expect(executions).toBe(1);
    expect(sequences).toEqual([0, 1]);
    expect(completions).toEqual(["completed"]);
  });

  it("durably queues every event while live upload stalls and replays it without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    let releaseUpload: (() => void) | undefined;
    const stalledUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let offline = true;
    let executions = 0;
    const uploaded: number[] = [];
    const transport = {
      lease: () => Promise.resolve(lease),
      recordEvents: async (
        _lease: RunnerLease,
        events: { sequence: number }[],
      ) => {
        if (offline) {
          await stalledUpload;
          throw new Error("network unavailable");
        }
        uploaded.push(...events.map(({ sequence }) => sequence));
        return { throughSequence: events.at(-1)?.sequence ?? -1 };
      },
      saveCheckpoint: () => Promise.resolve(),
      complete: () => Promise.resolve(),
      cancellationStatus: () =>
        Promise.resolve({ cancellationRequested: false }),
    };
    const worker = new RunnerWorker({
      state,
      transport,
      executor: {
        canResume: () => false,
        execute: async (_lease, context) => {
          executions += 1;
          await context.emit({
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          });
          await context.emit({
            type: "case_completed",
            at: "2026-07-01T10:00:01.000Z",
            caseId: "clamp-bounds",
            observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
          });
          return {
            status: "completed" as const,
            observations: [],
            artifacts: [],
            error: null,
          };
        },
      },
    });

    const firstRun = worker.runOnce();
    await expect
      .poll(async () => {
        const raw = await readFile(
          state.path("events") + `/${lease.attemptId}.jsonl`,
          "utf8",
        ).catch(() => "");
        return raw.trim().split("\n").filter(Boolean).length;
      })
      .toBe(2);
    releaseUpload?.();
    await expect(firstRun).resolves.toBe("buffered");

    offline = false;
    await expect(worker.runOnce()).resolves.toBe("completed");
    expect(executions).toBe(1);
    expect(uploaded).toEqual([0, 1]);
  });

  it("delivers events appended behind a successful live upload in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    let releaseUpload: (() => void) | undefined;
    const stalledUpload = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let calls = 0;
    const uploaded: number[] = [];
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: async (_lease, events) => {
          calls += 1;
          if (calls === 1) await stalledUpload;
          uploaded.push(...events.map(({ sequence }) => sequence));
          return { throughSequence: events.at(-1)?.sequence ?? -1 };
        },
        saveCheckpoint: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => false,
        execute: async (_lease, context) => {
          await context.emit({
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          });
          await context.emit({
            type: "case_completed",
            at: "2026-07-01T10:00:01.000Z",
            caseId: "clamp-bounds",
            observations: [],
          });
          releaseUpload?.();
          return {
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          };
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    await expect.poll(() => uploaded).toEqual([0, 1]);
    await expect.poll(() => worker.runOnce()).toBe("completed");
    expect(uploaded).toEqual([0, 1]);
  });

  it("marks a restarted non-resumable job interrupted instead of spending again", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    await state.saveActiveJob({
      lease,
      terminal: null,
      artifactsUploaded: false,
      executionStarted: true,
    });
    let executions = 0;
    const completions: string[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(null),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: (_lease, terminal) => {
          completions.push(terminal.status);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => false,
        execute: () => {
          executions += 1;
          return Promise.resolve({
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          });
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("interrupted");
    expect(executions).toBe(0);
    expect(completions).toEqual(["interrupted"]);
  });

  it("aborts cancelled work and reports its partial artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const uploaded: string[] = [];
    const completed: { status: string; artifacts: unknown[] }[] = [];
    let cancellationChecks = 0;
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: (_lease, terminal) => {
          completed.push(terminal);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: cancellationChecks++ > 0 }),
      },
      artifactUploader: {
        upload: (_lease, artifact) => {
          uploaded.push(artifact.blobPath);
          return Promise.resolve();
        },
      },
      executor: {
        canResume: () => false,
        execute: async (_lease, context) => {
          await context.emit({
            type: "job_started",
            at: "2026-07-01T10:00:00.000Z",
            jobId: lease.jobId,
          });
          expect(context.signal.aborted).toBe(true);
          return {
            status: "cancelled",
            observations: [],
            artifacts: [
              {
                kind: "diff",
                blobPath: `attempts/${lease.attemptId}/partial.patch`,
                contentHash: "partial",
                byteLength: 7,
              },
            ],
            error: null,
          };
        },
      },
    });

    const firstResult = await worker.runOnce();
    if (firstResult === "buffered") {
      await expect.poll(() => worker.runOnce()).toBe("cancelled");
    } else {
      expect(firstResult).toBe("cancelled");
    }
    expect(uploaded).toEqual([`attempts/${lease.attemptId}/partial.patch`]);
    expect(completed[0]).toMatchObject({
      status: "cancelled",
      artifacts: [{ contentHash: "partial" }],
    });
  });

  it("polls cancellation while a production-style executor emits no events", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    let cancellationChecks = 0;
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        cancellationStatus: () => {
          const cancellationRequested = cancellationChecks++ > 0;
          return new Promise((resolve) =>
            setTimeout(() => resolve({ cancellationRequested }), 5),
          );
        },
      },
      executor: {
        canResume: () => false,
        execute: (_lease, context) =>
          new Promise((resolve) => {
            const fallback = setTimeout(
              () =>
                resolve({
                  status: "completed",
                  observations: [],
                  artifacts: [],
                  error: null,
                }),
              100,
            );
            context.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(fallback);
                resolve({
                  status: "cancelled",
                  observations: [],
                  artifacts: [],
                  error: null,
                });
              },
              { once: true },
            );
          }),
      },
      cancellationPollIntervalMs: 1,
    });

    await expect(worker.runOnce()).resolves.toBe("cancelled");
    expect(cancellationChecks).toBeGreaterThan(1);
  });

  it("retries a transient cancellation check without losing an unstarted lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    let checks = 0;
    let executions = 0;
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        cancellationStatus: () => {
          checks += 1;
          return checks === 1
            ? Promise.reject(new Error("temporary network failure"))
            : Promise.resolve({ cancellationRequested: false });
        },
      },
      executor: {
        canResume: () => false,
        execute: () => {
          executions += 1;
          return Promise.resolve({
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          });
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    await expect(worker.runOnce()).resolves.toBe("completed");
    expect(executions).toBe(1);
  });

  it("does not overlap cancellation polls and ignores a late response", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    let checks = 0;
    const pending: {
      release?: (value: { cancellationRequested: boolean }) => void;
    } = {};
    const worker = new RunnerWorker({
      state: new RunnerStateStore(join(root, "state")),
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        cancellationStatus: () => {
          checks += 1;
          if (checks === 1) {
            return Promise.resolve({ cancellationRequested: false });
          }
          return new Promise((resolve) => {
            pending.release = resolve;
          });
        },
      },
      executor: {
        canResume: () => false,
        execute: () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: "completed",
                  observations: [],
                  artifacts: [],
                  error: null,
                }),
              10,
            ),
          ),
      },
      cancellationPollIntervalMs: 1,
    });

    await expect(worker.runOnce()).resolves.toBe("completed");
    expect(checks).toBe(2);
    pending.release?.({ cancellationRequested: true });
    await Promise.resolve();
  });

  it("durably reports executor preflight rejection without leaking its error", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const terminals: unknown[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? 0 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: (_lease, terminal) => {
          terminals.push(terminal);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => false,
        execute: () =>
          Promise.reject(
            new Error("secret-canary and ciphertext-canary must not leak"),
          ),
      },
    });

    await expect(worker.runOnce()).resolves.toBe("failed");
    expect(terminals).toEqual([
      {
        status: "failed",
        observations: [],
        artifacts: [],
        error: {
          kind: "executor_error",
          message: "Runner rejected the leased execution before completion.",
        },
      },
    ]);
    expect(JSON.stringify(terminals)).not.toContain("canary");
    await expect(state.activeJob()).resolves.toBeNull();
  });

  it("returns idle without a lease and cancels a server-marked lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const completions: string[] = [];
    let nextLease: RunnerLease | null = null;
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(nextLease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: (_lease, terminal) => {
          completions.push(terminal.status);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => false,
        execute: () => Promise.reject(new Error("must not execute")),
      },
    });

    await expect(worker.runOnce()).resolves.toBe("idle");
    nextLease = { ...lease, cancellationRequested: true };
    await expect(worker.runOnce()).resolves.toBe("cancelled");
    expect(completions).toEqual(["cancelled"]);
  });

  it("persists executor checkpoints and skips an already-delivered sequence", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const checkpoint = {
      sequence: 0,
      resumable: true,
      state: { threadId: "thread-1" },
    };
    const saved: unknown[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: (_lease, value) => {
          saved.push(value);
          return Promise.resolve();
        },
        complete: () => Promise.reject(new Error("offline after execution")),
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => true,
        execute: async (_lease, context) => {
          await context.saveCheckpoint(checkpoint);
          expect((await state.activeJob())?.lease.checkpoint).toEqual(
            checkpoint,
          );
          await context.saveCheckpoint(checkpoint);
          return {
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          };
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    expect(saved).toEqual([checkpoint]);
    await expect(state.activeJob()).resolves.toMatchObject({
      lease: { checkpoint },
      terminal: { status: "completed" },
    });
  });

  it("retries an offline checkpoint upload without failing or rerunning completed work", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const checkpoint = {
      sequence: 0,
      resumable: true,
      state: { threadId: "thread-offline" },
    };
    let offline = true;
    let executions = 0;
    const delivered: unknown[] = [];
    const completions: string[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: (_lease, value) => {
          if (offline) return Promise.reject(new Error("network unavailable"));
          delivered.push(value);
          return Promise.resolve();
        },
        complete: (_lease, terminal) => {
          completions.push(terminal.status);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => true,
        execute: async (_lease, context) => {
          executions += 1;
          await context.saveCheckpoint(checkpoint);
          return {
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          };
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    await expect(state.activeJob()).resolves.toMatchObject({
      lease: { checkpoint },
      terminal: { status: "completed" },
    });
    expect(executions).toBe(1);
    expect(completions).toEqual([]);

    offline = false;
    await expect(worker.runOnce()).resolves.toBe("completed");
    expect(delivered).toEqual([checkpoint]);
    expect(executions).toBe(1);
    expect(completions).toEqual(["completed"]);
    await expect(state.activeJob()).resolves.toBeNull();
  });

  it("buffers terminal delivery while a live checkpoint upload is still pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const checkpoint = {
      sequence: 0,
      resumable: true,
      state: { threadId: "thread-pending" },
    };
    let releaseCheckpoint: (() => void) | undefined;
    const pendingCheckpoint = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    let executions = 0;
    const completions: string[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(lease),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => pendingCheckpoint,
        complete: (_lease, terminal) => {
          completions.push(terminal.status);
          return Promise.resolve();
        },
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => true,
        execute: async (_lease, context) => {
          executions += 1;
          await context.saveCheckpoint(checkpoint);
          return {
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          };
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("buffered");
    expect(completions).toEqual([]);
    releaseCheckpoint?.();
    await expect.poll(() => worker.runOnce()).toBe("completed");
    expect(executions).toBe(1);
    expect(completions).toEqual(["completed"]);
  });

  it("resumes only when the executor accepts a stored checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const resumableLease = {
      ...lease,
      checkpoint: { sequence: 2, resumable: true, state: { cursor: 2 } },
    };
    await state.saveActiveJob({
      lease: resumableLease,
      terminal: null,
      artifactsUploaded: false,
      executionStarted: true,
    });
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(null),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
        saveCheckpoint: () => Promise.resolve(),
        complete: () => Promise.resolve(),
        cancellationStatus: () =>
          Promise.resolve({ cancellationRequested: false }),
      },
      executor: {
        canResume: () => true,
        execute: (_lease, context) => {
          expect(context.checkpoint).toEqual(resumableLease.checkpoint);
          return Promise.resolve({
            status: "completed",
            observations: [],
            artifacts: [],
            error: null,
          });
        },
      },
    });

    await expect(worker.runOnce()).resolves.toBe("completed");
  });
});
