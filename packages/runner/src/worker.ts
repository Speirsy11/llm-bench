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
  complete(lease: RunnerLease, terminal: Terminal): Promise<void>;
  cancellationStatus(
    lease: RunnerLease,
  ): Promise<{ cancellationRequested: boolean }>;
}

export interface RunnerExecutor {
  canResume(checkpoint: RunnerCheckpoint): boolean;
  execute(
    lease: RunnerLease,
    context: {
      signal: AbortSignal;
      checkpoint: RunnerCheckpoint | null;
      emit(event: BenchmarkEvent): Promise<void>;
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
  constructor(
    private readonly options: {
      state: RunnerStateStore;
      transport: RunnerTransport;
      executor: RunnerExecutor;
      artifactUploader?: RunnerArtifactUploader;
    },
  ) {}

  async runOnce(): Promise<
    "idle" | "buffered" | "completed" | "failed" | "cancelled" | "interrupted"
  > {
    const recovered = await this.options.state.activeJob();
    if (recovered?.terminal) {
      return this.deliver({ ...recovered, terminal: recovered.terminal });
    }

    const active = recovered ?? (await this.claim());
    if (!active) return "idle";

    if (
      recovered &&
      (!active.lease.checkpoint ||
        !this.options.executor.canResume(active.lease.checkpoint))
    ) {
      const interrupted = {
        ...active,
        terminal: terminal("interrupted", {
          message: "Harness cannot resume the stored checkpoint.",
        }),
      };
      await this.options.state.saveActiveJob(interrupted);
      return this.deliver(interrupted);
    }

    const cancellation = await this.options.transport.cancellationStatus(
      active.lease,
    );
    if (
      active.lease.cancellationRequested ||
      cancellation.cancellationRequested
    ) {
      const cancelled = { ...active, terminal: terminal("cancelled", null) };
      await this.options.state.saveActiveJob(cancelled);
      return this.deliver(cancelled);
    }

    const abort = new AbortController();
    const eventBuffer = this.eventBuffer(active.lease);
    const result = await this.options.executor.execute(active.lease, {
      signal: abort.signal,
      checkpoint: active.lease.checkpoint,
      emit: async (event) => {
        await eventBuffer.append(event);
        await eventBuffer
          .flush((events) =>
            this.options.transport.recordEvents(active.lease, events),
          )
          .catch(() => undefined);
        const status = await this.options.transport
          .cancellationStatus(active.lease)
          .catch(() => ({ cancellationRequested: false }));
        if (status.cancellationRequested) abort.abort();
      },
    });
    const completed = { ...active, terminal: result };
    await this.options.state.saveActiveJob(completed);
    return this.deliver(completed);
  }

  private async claim(): Promise<ActiveRunnerJob | null> {
    const lease = await this.options.transport.lease();
    if (!lease) return null;
    const active = { lease, terminal: null, artifactsUploaded: false };
    await this.options.state.saveActiveJob(active);
    return active;
  }

  private async deliver(active: ActiveRunnerJob & { terminal: Terminal }) {
    const eventBuffer = this.eventBuffer(active.lease);
    try {
      if (this.options.artifactUploader && !active.artifactsUploaded) {
        for (const artifact of active.terminal.artifacts) {
          await this.options.artifactUploader.upload(active.lease, artifact);
        }
        active.artifactsUploaded = true;
        await this.options.state.saveActiveJob(active);
      }
      await eventBuffer.flush((events) =>
        this.options.transport.recordEvents(active.lease, events),
      );
      await this.options.transport.complete(active.lease, active.terminal);
    } catch {
      return "buffered" as const;
    }
    const status = active.terminal.status;
    await this.options.state.clearActiveJob();
    return status;
  }

  private eventBuffer(lease: RunnerLease): DurableEventBuffer {
    return new DurableEventBuffer(
      this.options.state.path("events") + `/${lease.attemptId}.jsonl`,
    );
  }
}

function terminal(
  status: "cancelled" | "interrupted",
  error: Record<string, unknown> | null,
): Terminal {
  return { status, observations: [], artifacts: [], error };
}
