import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  BenchmarkEvent,
  Capability,
  RunnerCheckpoint,
  RunnerEventBatchRequest,
  RunnerLease,
  RunnerTerminalRequest,
} from "@llm-bench/contracts";

import type { PairedRunner } from "./runner-protocol";

export interface QueuedRunnerJob {
  id: string;
  ownerId: string;
  benchmark: { id: string; version: string };
  requiredCapabilities: Capability[];
  status:
    | "queued"
    | "leased"
    | "preparing"
    | "running"
    | "grading"
    | "uploading"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  position: number;
  assignedRunnerId: string | null;
  cancellationRequested: boolean;
  experimentId?: string;
  targetId?: string;
  retryOfJobId?: string | null;
}

export interface RunnerAttempt {
  id: string;
  jobId: string;
  runnerId: string;
  leaseTokenHash: string;
  status: QueuedRunnerJob["status"];
  checkpoint: RunnerCheckpoint | null;
  terminal: Omit<
    RunnerTerminalRequest,
    "protocolVersion" | "leaseToken"
  > | null;
}

export interface StoredRunnerEvent {
  attemptId: string;
  sequence: number;
  event: BenchmarkEvent;
}

export interface RunnerJobStore {
  enqueue(job: QueuedRunnerJob): Promise<void>;
  claimNext(input: {
    runner: PairedRunner;
    attemptId: string;
    leaseTokenHash: string;
  }): Promise<{ job: QueuedRunnerJob; attempt: RunnerAttempt } | null>;
  findAttempt(attemptId: string): Promise<RunnerAttempt | null>;
  findJob(jobId: string): Promise<QueuedRunnerJob | null>;
  markRunning(attemptId: string, jobId: string): Promise<void>;
  complete(
    attemptId: string,
    jobId: string,
    status: RunnerAttempt["status"],
    terminal: RunnerAttempt["terminal"],
  ): Promise<void>;
  saveCheckpoint(
    attemptId: string,
    checkpoint: RunnerCheckpoint,
  ): Promise<boolean>;
  setCancellation(jobId: string): Promise<void>;
  saveEvent(event: StoredRunnerEvent): Promise<void>;
}

export interface InMemoryRunnerJobStore extends RunnerJobStore {
  inspect(): {
    jobs: QueuedRunnerJob[];
    attempts: RunnerAttempt[];
    events: StoredRunnerEvent[];
  };
}

export function createInMemoryRunnerJobStore(): InMemoryRunnerJobStore {
  const jobs: QueuedRunnerJob[] = [];
  const attempts: RunnerAttempt[] = [];
  const events: StoredRunnerEvent[] = [];
  return {
    enqueue(job) {
      jobs.push(job);
      return Promise.resolve();
    },
    claimNext({ runner, attemptId, leaseTokenHash }) {
      const active = attempts.some(
        (attempt) =>
          attempt.runnerId === runner.id &&
          ["leased", "preparing", "running", "grading", "uploading"].includes(
            attempt.status,
          ),
      );
      if (active) return Promise.resolve(null);
      const job = jobs
        .filter(
          (candidate) =>
            candidate.status === "queued" &&
            candidate.ownerId === runner.ownerId &&
            (!candidate.assignedRunnerId ||
              candidate.assignedRunnerId === runner.id) &&
            candidate.requiredCapabilities.every((capability) =>
              runner.capabilities.includes(capability),
            ),
        )
        .sort((left, right) => left.position - right.position)[0];
      if (!job) return Promise.resolve(null);
      job.status = "leased";
      job.assignedRunnerId = runner.id;
      const attempt: RunnerAttempt = {
        id: attemptId,
        jobId: job.id,
        runnerId: runner.id,
        leaseTokenHash,
        status: "leased",
        checkpoint: null,
        terminal: null,
      };
      attempts.push(attempt);
      return Promise.resolve({ job, attempt });
    },
    findAttempt(attemptId) {
      return Promise.resolve(
        attempts.find((attempt) => attempt.id === attemptId) ?? null,
      );
    },
    findJob(jobId) {
      return Promise.resolve(jobs.find((job) => job.id === jobId) ?? null);
    },
    markRunning(attemptId, jobId) {
      const attempt = requiredStoredAttempt(attempts, attemptId);
      const job = requiredStoredJob(jobs, jobId);
      if (attempt.status === "leased") attempt.status = "running";
      if (job.status === "leased") job.status = "running";
      return Promise.resolve();
    },
    complete(attemptId, jobId, status, terminal) {
      const attempt = requiredStoredAttempt(attempts, attemptId);
      const job = requiredStoredJob(jobs, jobId);
      if (!isTerminal(attempt.status)) {
        attempt.status = status;
        attempt.terminal = terminal;
      }
      if (!isTerminal(job.status)) job.status = status;
      return Promise.resolve();
    },
    saveCheckpoint(attemptId, checkpoint) {
      const attempt = requiredStoredAttempt(attempts, attemptId);
      if (
        isTerminal(attempt.status) ||
        (attempt.checkpoint &&
          checkpoint.sequence <= attempt.checkpoint.sequence)
      ) {
        return Promise.resolve(false);
      }
      attempt.checkpoint = checkpoint;
      return Promise.resolve(true);
    },
    setCancellation(jobId) {
      const job = requiredStoredJob(jobs, jobId);
      if (!isTerminal(job.status)) job.cancellationRequested = true;
      return Promise.resolve();
    },
    saveEvent(event) {
      const duplicate = events.some(
        (candidate) =>
          candidate.attemptId === event.attemptId &&
          candidate.sequence === event.sequence,
      );
      if (!duplicate) events.push(event);
      return Promise.resolve();
    },
    inspect() {
      return { jobs, attempts, events };
    },
  };
}

export function createRunnerJobService({
  store,
  randomToken = () => randomBytes(32).toString("base64url"),
}: {
  store: RunnerJobStore;
  randomToken?: () => string;
}) {
  let nextPosition = 0;
  return {
    async enqueue(input: {
      ownerId: string;
      benchmark: { id: string; version: string };
      requiredCapabilities: Capability[];
      experimentId?: string;
      targetId?: string;
    }): Promise<QueuedRunnerJob> {
      const job: QueuedRunnerJob = {
        id: randomUUID(),
        ...input,
        status: "queued",
        position: nextPosition++,
        assignedRunnerId: null,
        cancellationRequested: false,
      };
      await store.enqueue(job);
      return job;
    },

    async lease(runner: PairedRunner): Promise<RunnerLease | null> {
      const leaseToken = randomToken();
      const claimed = await store.claimNext({
        runner,
        attemptId: randomUUID(),
        leaseTokenHash: hashSecret(leaseToken),
      });
      if (!claimed) return null;
      return {
        jobId: claimed.job.id,
        attemptId: claimed.attempt.id,
        leaseToken,
        benchmark: claimed.job.benchmark,
        queuePosition: claimed.job.position,
        checkpoint: claimed.attempt.checkpoint,
        cancellationRequested: claimed.job.cancellationRequested,
      };
    },

    async recordEvents(
      runner: PairedRunner,
      request: RunnerEventBatchRequest,
    ): Promise<{ throughSequence: number }> {
      const attempt = await authorizeAttempt(store, runner, request);
      if (isTerminal(attempt.status)) {
        throw new Error("Attempt is already terminal.");
      }
      for (const item of request.events) {
        await store.saveEvent({ attemptId: attempt.id, ...item });
      }
      if (attempt.status === "leased") {
        await store.markRunning(attempt.id, attempt.jobId);
      }
      return {
        throughSequence: Math.max(
          ...request.events.map(({ sequence }) => sequence),
        ),
      };
    },

    async complete(
      runner: PairedRunner,
      request: RunnerTerminalRequest,
    ): Promise<void> {
      const attempt = await authorizeAttempt(store, runner, request);
      const terminal = {
        attemptId: request.attemptId,
        status: request.status,
        observations: request.observations,
        artifacts: request.artifacts,
        error: request.error,
      };
      await store.complete(attempt.id, attempt.jobId, request.status, terminal);
    },

    async saveCheckpoint(
      runner: PairedRunner,
      request: {
        attemptId: string;
        leaseToken: string;
        checkpoint: RunnerCheckpoint;
      },
    ): Promise<void> {
      const attempt = await authorizeAttempt(store, runner, request);
      if (!(await store.saveCheckpoint(attempt.id, request.checkpoint))) {
        throw new Error("Checkpoint sequence must advance.");
      }
    },

    async requestCancellation(ownerId: string, jobId: string): Promise<void> {
      const job = await store.findJob(jobId);
      if (job?.ownerId !== ownerId) {
        throw new Error("Job is unavailable.");
      }
      await store.setCancellation(job.id);
    },

    async cancellationStatus(
      runner: PairedRunner,
      request: { attemptId: string; leaseToken: string },
    ): Promise<{ cancellationRequested: boolean }> {
      const attempt = await authorizeAttempt(store, runner, request);
      const job = await requiredJob(store, attempt.jobId);
      return { cancellationRequested: job.cancellationRequested };
    },
  };
}

async function authorizeAttempt(
  store: RunnerJobStore,
  runner: PairedRunner,
  request: { attemptId: string; leaseToken: string },
): Promise<RunnerAttempt> {
  const attempt = await store.findAttempt(request.attemptId);
  if (
    !attempt ||
    attempt.runnerId !== runner.id ||
    attempt.leaseTokenHash !== hashSecret(request.leaseToken)
  ) {
    throw new Error("Attempt lease is unavailable.");
  }
  return attempt;
}

async function requiredJob(
  store: RunnerJobStore,
  jobId: string,
): Promise<QueuedRunnerJob> {
  const job = await store.findJob(jobId);
  if (!job) throw new Error("Job is unavailable.");
  return job;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function isTerminal(status: QueuedRunnerJob["status"]): boolean {
  return ["completed", "failed", "cancelled", "interrupted"].includes(status);
}

function requiredStoredAttempt(
  attempts: RunnerAttempt[],
  attemptId: string,
): RunnerAttempt {
  const attempt = attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error("Attempt is unavailable.");
  return attempt;
}

function requiredStoredJob(
  jobs: QueuedRunnerJob[],
  jobId: string,
): QueuedRunnerJob {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Job is unavailable.");
  return job;
}
