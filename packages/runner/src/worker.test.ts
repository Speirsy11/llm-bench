import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunnerLease } from "@llm-bench/contracts";

import { RunnerStateStore } from "./state";
import { RunnerWorker } from "./worker";

const lease: RunnerLease = {
  jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
  attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
  leaseToken: "lease-token",
  benchmark: { id: "repository-repair", version: "1.0.0" },
  queuePosition: 0,
  checkpoint: null,
  cancellationRequested: false,
};

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

  it("marks a restarted non-resumable job interrupted instead of spending again", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-worker-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    await state.saveActiveJob({
      lease,
      terminal: null,
      artifactsUploaded: false,
    });
    let executions = 0;
    const completions: string[] = [];
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(null),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
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

    await expect(worker.runOnce()).resolves.toBe("cancelled");
    expect(uploaded).toEqual([`attempts/${lease.attemptId}/partial.patch`]);
    expect(completed[0]).toMatchObject({
      status: "cancelled",
      artifacts: [{ contentHash: "partial" }],
    });
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
    });
    const worker = new RunnerWorker({
      state,
      transport: {
        lease: () => Promise.resolve(null),
        recordEvents: (_lease, events) =>
          Promise.resolve({ throughSequence: events.at(-1)?.sequence ?? -1 }),
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
