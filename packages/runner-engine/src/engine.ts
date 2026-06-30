import { existsSync } from "node:fs";

import type { Artifact, Limits, MetricObservation } from "@llm-bench/contracts";

import type { ArtifactStore } from "./artifact-store";
import type { WorkspaceDiff } from "./diff";
import type { JsonlEventSpool } from "./event-spool";
import type { GradeResult } from "./grader";
import type { FixtureHarness, RepairScenario } from "./scenario";
import { captureDiff, renderDiffText } from "./diff";
import { gradeHiddenTests } from "./grader";
import { Workspace } from "./workspace";

/** Terminal outcome of a single local agentic task run. */
export type ExecutionStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface ExecuteAgenticTaskOptions {
  jobId: string;
  scenario: RepairScenario;
  harness: FixtureHarness;
  limits: Limits;
  artifactStore: ArtifactStore;
  eventSpool: JsonlEventSpool;
  workspaceRoot: string;
  /** External cancellation signal. */
  cancel?: AbortSignal;
  /** Deadline signal; defaults to the configured duration limit. */
  deadline?: AbortSignal;
  /** Injectable clock for deterministic timing. */
  now?: () => number;
}

export interface ExecutionResult {
  jobId: string;
  status: ExecutionStatus;
  grade: GradeResult | null;
  observations: MetricObservation[];
  trajectory: string[];
  diff: WorkspaceDiff;
  diffArtifact: Artifact;
  durationMs: number;
  cleanedUp: boolean;
  workspaceRoot: string;
}

/**
 * Runs one repair task end to end without a server: prepares an ephemeral
 * workspace, runs the harness under a combined cancel/deadline signal, injects
 * hidden grading only after the harness finishes, records typed observations,
 * stores the final diff as an artifact, and deletes the workspace.
 */
export async function executeAgenticTask(
  options: ExecuteAgenticTaskOptions,
): Promise<ExecutionResult> {
  const { jobId, scenario, limits, artifactStore, eventSpool } = options;
  const now = options.now ?? Date.now;
  const deadline =
    options.deadline ?? AbortSignal.timeout(limits.maxDurationMs);
  const signals = options.cancel ? [options.cancel, deadline] : [deadline];
  const signal = AbortSignal.any(signals);

  const start = now();
  await eventSpool.append({
    type: "job_started",
    at: new Date(start).toISOString(),
    jobId,
  });

  const workspace = await Workspace.create(options.workspaceRoot);
  try {
    await scenario.prepare(workspace);
    const before = await workspace.snapshot();

    let trajectory: string[] = [];
    let harnessError: unknown = null;
    try {
      const outcome = await options.harness.repair({ workspace, signal });
      trajectory = outcome.trajectory;
    } catch (error) {
      harnessError = error;
    }

    const diff = captureDiff(before, await workspace.snapshot());

    let status = classify(options.cancel, deadline, harnessError);
    let grade: GradeResult | null = null;
    if (status === "completed") {
      grade = await gradeHiddenTests(workspace, scenario.hiddenTests);
      // Grading is part of the run: if cancel/deadline fired while the hidden
      // tests ran, honour the interruption instead of reporting a grade.
      const afterGrading = classify(options.cancel, deadline, harnessError);
      if (afterGrading !== "completed") {
        status = afterGrading;
        grade = null;
      }
    }

    const observations: MetricObservation[] = [
      {
        metricId: scenario.benchmark.primaryMetric().id,
        value: grade === null ? null : grade.ratio,
      },
    ];

    // Persist outputs before writing any terminal event, so the spool only
    // becomes terminal once the artifact is durably stored.
    const diffArtifact = await artifactStore.put({
      jobId,
      mediaType: "text/x-diff",
      bytes: Buffer.from(renderDiffText(diff), "utf8"),
    });

    const end = now();
    const endedAt = new Date(end).toISOString();
    await appendTerminalEvent(eventSpool, {
      status,
      endedAt,
      caseId: scenario.task.id,
      observations,
      harnessError,
      limitMs: limits.maxDurationMs,
    });

    await workspace.cleanup();

    return {
      jobId,
      status,
      grade,
      observations,
      trajectory,
      diff,
      diffArtifact,
      durationMs: end - start,
      cleanedUp: !existsSync(workspace.root),
      workspaceRoot: workspace.root,
    };
  } catch (error) {
    // Any failure after the workspace exists must still remove the temp tree.
    await workspace.cleanup();
    throw error;
  }
}

interface TerminalEvent {
  status: ExecutionStatus;
  endedAt: string;
  caseId: string;
  observations: MetricObservation[];
  harnessError: unknown;
  limitMs: number;
}

async function appendTerminalEvent(
  eventSpool: JsonlEventSpool,
  event: TerminalEvent,
): Promise<void> {
  if (event.status === "completed") {
    await eventSpool.append({
      type: "case_completed",
      at: event.endedAt,
      caseId: event.caseId,
      observations: event.observations,
    });
  } else if (event.status === "failed") {
    await eventSpool.append({
      type: "job_failed",
      at: event.endedAt,
      failure: {
        kind: "harness_error",
        message: describeError(event.harnessError),
      },
    });
  } else if (event.status === "timed_out") {
    await eventSpool.append({
      type: "job_failed",
      at: event.endedAt,
      failure: { kind: "timeout", limitMs: event.limitMs },
    });
  }
}

function classify(
  cancel: AbortSignal | undefined,
  deadline: AbortSignal,
  harnessError: unknown,
): ExecutionStatus {
  if (cancel?.aborted === true) {
    return "cancelled";
  }
  if (deadline.aborted) {
    return "timed_out";
  }
  if (harnessError !== null) {
    return "failed";
  }
  return "completed";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
