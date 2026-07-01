import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunnerLease } from "@llm-bench/contracts";

import { TracerExecutor } from "./tracer-executor";

describe("TracerExecutor", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("executes the repository-repair tracer through the runner boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-tracer-"));
    roots.push(root);
    const lease: RunnerLease = {
      jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
      leaseToken: "lease-token",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      queuePosition: 0,
      checkpoint: null,
      cancellationRequested: false,
    };
    const events: string[] = [];

    const result = await new TracerExecutor(root).execute(lease, {
      signal: new AbortController().signal,
      checkpoint: null,
      emit: (event) => {
        events.push(event.type);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      observations: [{ metricId: "hidden_test_pass_ratio", value: 1 }],
      artifacts: [{ kind: "diff" }],
      error: null,
    });
    expect(result.artifacts[0]?.byteLength).toBeGreaterThan(0);
    expect(events).toEqual(["job_started", "case_completed"]);
  });

  it("rejects unknown benchmarks and never resumes the fixture harness", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-tracer-"));
    roots.push(root);
    const executor = new TracerExecutor(root);
    expect(
      executor.canResume({ sequence: 1, resumable: true, state: {} }),
    ).toBe(false);
    await expect(
      executor.execute(
        {
          jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
          attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
          leaseToken: "lease-token",
          benchmark: { id: "unknown", version: "1.0.0" },
          queuePosition: 0,
          checkpoint: null,
          cancellationRequested: false,
        },
        {
          signal: new AbortController().signal,
          checkpoint: null,
          emit: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow("Unsupported benchmark: unknown");
  });

  it("normalizes harness failures and deadlines", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-tracer-"));
    roots.push(root);
    const baseLease: RunnerLease = {
      jobId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
      leaseToken: "lease-token",
      benchmark: { id: "repository-repair", version: "1.0.0" },
      queuePosition: 0,
      checkpoint: null,
      cancellationRequested: false,
    };
    const context = {
      signal: new AbortController().signal,
      checkpoint: null,
      emit: () => Promise.resolve(),
    };
    const failed = await new TracerExecutor(root, {
      harness: { repair: () => Promise.reject(new Error("failed")) },
    }).execute(baseLease, context);
    expect(failed).toMatchObject({
      status: "failed",
      error: { kind: "failed" },
    });

    const deadline = AbortSignal.abort();
    const timedOut = await new TracerExecutor(root, { deadline }).execute(
      { ...baseLease, attemptId: "b0b59122-2e34-4a75-9d70-ac0c7d8323e3" },
      context,
    );
    expect(timedOut).toMatchObject({
      status: "failed",
      error: { kind: "timed_out" },
    });
  });
});
