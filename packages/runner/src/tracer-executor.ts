import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { RunnerCheckpoint, RunnerLease } from "@llm-bench/contracts";
import type { FixtureHarness } from "@llm-bench/runner-engine";
import {
  knownPatchHarness,
  repairScenario,
} from "@llm-bench/repository-repair";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

import type { RunnerExecutor } from "./worker";

export class TracerExecutor implements RunnerExecutor {
  constructor(
    private readonly root: string,
    private readonly options: {
      harness?: FixtureHarness;
      deadline?: AbortSignal;
    } = {},
  ) {}

  canResume(_checkpoint: RunnerCheckpoint): boolean {
    return false;
  }

  async execute(
    lease: RunnerLease,
    context: Parameters<RunnerExecutor["execute"]>[1],
  ): ReturnType<RunnerExecutor["execute"]> {
    if (lease.benchmark.id !== "repository-repair") {
      throw new Error(`Unsupported benchmark: ${lease.benchmark.id}`);
    }
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
    const eventSpool = new JsonlEventSpool(
      join(spoolRoot, `${lease.attemptId}.jsonl`),
    );
    const result = await executeAgenticTask({
      jobId: lease.jobId,
      scenario: repairScenario(),
      harness: this.options.harness ?? knownPatchHarness(),
      limits: {
        maxDurationMs: 30_000,
        maxToolCalls: 10,
        maxTokens: 10_000,
      },
      artifactStore,
      eventSpool,
      workspaceRoot,
      cancel: context.signal,
      deadline: this.options.deadline,
    });
    for (const event of await eventSpool.events()) await context.emit(event);
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
}

function normalizeStatus(
  status: "completed" | "failed" | "cancelled" | "timed_out",
): "completed" | "failed" | "cancelled" {
  return status === "timed_out" ? "failed" : status;
}
