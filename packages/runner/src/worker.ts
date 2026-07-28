import type {
  BenchmarkEvent,
  MetricObservation,
  RunnerArtifactReference,
  RunnerCheckpoint,
  RunnerLease,
  RunnerTerminalRequest,
} from "@llm-bench/contracts";

import type { BufferedEvent } from "./event-buffer";
import type { ActiveRunnerJob, RunnerStateStore } from "./state";
import { DurableEventBuffer } from "./event-buffer";

type Terminal = Omit<
  RunnerTerminalRequest,
  "protocolVersion" | "attemptId" | "leaseToken"
>;

export interface RunnerTransport {
  lease(): Promise<RunnerLease | null>;
  recordEvents(
    lease: RunnerLease,
    events: BufferedEvent[],
  ): Promise<{ throughSequence: number }>;
  saveCheckpoint(
    lease: RunnerLease,
    checkpoint: RunnerCheckpoint,
  ): Promise<void>;
  complete(lease: RunnerLease, terminal: Terminal): Promise<void>;
  cancellationStatus(
    lease: RunnerLease,
  ): Promise<{ cancellationRequested: boolean }>;
}

export interface RunnerExecutor {
  canResume(lease: RunnerLease, checkpoint: RunnerCheckpoint): boolean;
  execute(
    lease: RunnerLease,
    context: {
      signal: AbortSignal;
      checkpoint: RunnerCheckpoint | null;
      emit(event: BenchmarkEvent): Promise<void>;
      saveCheckpoint(checkpoint: RunnerCheckpoint): Promise<void>;
    },
  ): Promise<{
    status: Terminal["status"];
    observations: MetricObservation[];
    artifacts: RunnerArtifactReference[];
    error: Record<string, unknown> | null;
  }>;
}

export interface RunnerArtifactUploader {
  upload(lease: RunnerLease, artifact: RunnerArtifactReference): Promise<void>;
}

export class RunnerWorker {
  private readonly eventDeliveries = new Map<string, LiveEventDelivery>();
  private readonly checkpointDeliveries = new Map<
    string,
    LiveCheckpointDelivery
  >();

  constructor(
    private readonly options: {
      state: RunnerStateStore;
      transport: RunnerTransport;
      executor: RunnerExecutor;
      artifactUploader?: RunnerArtifactUploader;
      cancellationPollIntervalMs?: number;
    },
  ) {}

  async runOnce(): Promise<
    "idle" | "buffered" | "completed" | "failed" | "cancelled" | "interrupted"
  > {
    const recovered = await this.options.state.activeJob();
    if (recovered?.terminal) {
      return this.deliver(
        { ...recovered, terminal: recovered.terminal },
        this.eventDelivery(recovered.lease),
        this.checkpointDelivery(recovered.lease),
      );
    }

    const active = recovered ?? (await this.claim());
    if (!active) return "idle";

    if (
      recovered?.executionStarted &&
      (!active.lease.checkpoint ||
        !this.options.executor.canResume(active.lease, active.lease.checkpoint))
    ) {
      const interrupted = {
        ...active,
        terminal: terminal("interrupted", {
          message: "Harness cannot resume the stored checkpoint.",
        }),
      };
      await this.options.state.saveActiveJob(interrupted);
      return this.deliver(
        interrupted,
        this.eventDelivery(interrupted.lease),
        this.checkpointDelivery(interrupted.lease),
      );
    }

    const cancellation = await this.options.transport
      .cancellationStatus(active.lease)
      .catch(() => null);
    if (cancellation === null) return "buffered";
    if (
      active.lease.cancellationRequested ||
      cancellation.cancellationRequested
    ) {
      const cancelled = { ...active, terminal: terminal("cancelled", null) };
      await this.options.state.saveActiveJob(cancelled);
      return this.deliver(
        cancelled,
        this.eventDelivery(cancelled.lease),
        this.checkpointDelivery(cancelled.lease),
      );
    }

    const abort = new AbortController();
    const eventDelivery = this.eventDelivery(active.lease);
    const checkpointDelivery = this.checkpointDelivery(active.lease);
    if (!active.executionStarted) {
      active.executionStarted = true;
      await this.options.state.saveActiveJob(active);
    }
    const stopCancellationMonitor = this.monitorCancellation(
      active.lease,
      abort,
    );
    const result = await this.options.executor
      .execute(active.lease, {
        signal: abort.signal,
        checkpoint: active.lease.checkpoint,
        emit: async (event) => {
          await eventDelivery.append(event);
          const status = await this.options.transport
            .cancellationStatus(active.lease)
            .catch(() => ({ cancellationRequested: false }));
          if (status.cancellationRequested) abort.abort();
        },
        saveCheckpoint: async (checkpoint) => {
          active.lease = { ...active.lease, checkpoint };
          await this.options.state.saveActiveJob(active);
          checkpointDelivery.start(checkpoint);
        },
      })
      .catch(() => ({
        status: "failed" as const,
        observations: [],
        artifacts: [],
        error: {
          kind: "executor_error",
          message: "Runner rejected the leased execution before completion.",
        },
      }))
      .finally(stopCancellationMonitor);
    const completed = { ...active, terminal: result };
    await this.options.state.saveActiveJob(completed);
    return this.deliver(completed, eventDelivery, checkpointDelivery);
  }

  private async claim(): Promise<ActiveRunnerJob | null> {
    const lease = await this.options.transport.lease();
    if (!lease) return null;
    const active = {
      lease,
      terminal: null,
      artifactsUploaded: false,
      executionStarted: false,
    };
    await this.options.state.saveActiveJob(active);
    return active;
  }

  private async deliver(
    active: ActiveRunnerJob & { terminal: Terminal },
    eventDelivery: LiveEventDelivery,
    checkpointDelivery: LiveCheckpointDelivery,
  ) {
    if (
      !(await eventDelivery.readyForTerminal()) ||
      !(await checkpointDelivery.readyForTerminal())
    ) {
      return "buffered" as const;
    }
    try {
      await checkpointDelivery.flush(active.lease.checkpoint);
      if (this.options.artifactUploader && !active.artifactsUploaded) {
        for (const artifact of active.terminal.artifacts) {
          await this.options.artifactUploader.upload(active.lease, artifact);
        }
        active.artifactsUploaded = true;
        await this.options.state.saveActiveJob(active);
      }
      await eventDelivery.flush();
      await this.options.transport.complete(active.lease, active.terminal);
    } catch {
      return "buffered" as const;
    }
    const status = active.terminal.status;
    await this.options.state.clearActiveJob();
    this.eventDeliveries.delete(active.lease.attemptId);
    this.checkpointDeliveries.delete(active.lease.attemptId);
    return status;
  }

  private eventDelivery(lease: RunnerLease): LiveEventDelivery {
    const existing = this.eventDeliveries.get(lease.attemptId);
    if (existing) return existing;
    const delivery = new LiveEventDelivery(
      new DurableEventBuffer(
        this.options.state.path("events") + `/${lease.attemptId}.jsonl`,
      ),
      (events) => this.options.transport.recordEvents(lease, events),
    );
    this.eventDeliveries.set(lease.attemptId, delivery);
    return delivery;
  }

  private checkpointDelivery(lease: RunnerLease): LiveCheckpointDelivery {
    const existing = this.checkpointDeliveries.get(lease.attemptId);
    if (existing) return existing;
    const delivery = new LiveCheckpointDelivery((checkpoint) =>
      this.options.transport.saveCheckpoint(lease, checkpoint),
    );
    this.checkpointDeliveries.set(lease.attemptId, delivery);
    return delivery;
  }

  private monitorCancellation(
    lease: RunnerLease,
    abort: AbortController,
  ): () => void {
    let checking = false;
    let stopped = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.options.transport
        .cancellationStatus(lease)
        .then((status) => {
          if (!stopped && status.cancellationRequested) abort.abort();
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, this.options.cancellationPollIntervalMs ?? 1_000);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}

class LiveEventDelivery {
  private inFlight: Promise<void> | null = null;
  private requested = false;

  constructor(
    private readonly buffer: DurableEventBuffer,
    private readonly send: (events: BufferedEvent[]) => Promise<{
      throughSequence: number;
    }>,
  ) {}

  async readyForTerminal(): Promise<boolean> {
    const nextTurn = new Promise<false>((resolve) => {
      setImmediate(() => resolve(false));
    });
    while (this.inFlight) {
      const settled = await Promise.race([
        this.inFlight.then(
          () => true as const,
          () => true as const,
        ),
        nextTurn,
      ]);
      if (!settled) return false;
    }
    return true;
  }

  async append(event: BenchmarkEvent): Promise<void> {
    await this.buffer.append(event);
    this.requested = true;
    this.start();
  }

  async flush(): Promise<void> {
    await this.buffer.flush(this.send);
  }

  private start(): void {
    if (this.inFlight) return;
    this.requested = false;
    const delivery = this.buffer.flush(this.send);
    this.inFlight = delivery;
    void delivery.then(
      () => {
        this.inFlight = null;
        if (this.requested) this.start();
      },
      () => {
        this.inFlight = null;
      },
    );
  }
}

class LiveCheckpointDelivery {
  private deliveredSequence = -1;
  private inFlight: Promise<void> | null = null;
  private queued: RunnerCheckpoint | null = null;

  constructor(
    private readonly send: (checkpoint: RunnerCheckpoint) => Promise<void>,
  ) {}

  async readyForTerminal(): Promise<boolean> {
    const nextTurn = new Promise<false>((resolve) => {
      setImmediate(() => resolve(false));
    });
    while (this.inFlight) {
      const settled = await Promise.race([
        this.inFlight.then(
          () => true as const,
          () => true as const,
        ),
        nextTurn,
      ]);
      if (!settled) return false;
    }
    return true;
  }

  start(checkpoint: RunnerCheckpoint): void {
    if (checkpoint.sequence <= this.deliveredSequence) return;
    this.queued = checkpoint;
    this.startNext();
  }

  async flush(checkpoint: RunnerCheckpoint | null): Promise<void> {
    if (checkpoint === null || checkpoint.sequence <= this.deliveredSequence) {
      return;
    }
    await this.send(checkpoint);
    this.deliveredSequence = checkpoint.sequence;
  }

  private startNext(): void {
    if (this.inFlight || this.queued === null) return;
    const checkpoint = this.queued;
    this.queued = null;
    const delivery = this.send(checkpoint);
    this.inFlight = delivery;
    void delivery.then(
      () => {
        this.deliveredSequence = Math.max(
          this.deliveredSequence,
          checkpoint.sequence,
        );
        this.inFlight = null;
        this.startNext();
      },
      () => {
        this.inFlight = null;
        this.startNext();
      },
    );
  }
}

function terminal(
  status: "cancelled" | "interrupted",
  error: Record<string, unknown> | null,
): Terminal {
  return { status, observations: [], artifacts: [], error };
}
