import type {
  RunnerCheckpoint,
  RunnerEnvironment,
  RunnerLease,
  RunnerPairingPollResponse,
  RunnerPairingStartResponse,
} from "@llm-bench/contracts";
import {
  RUNNER_PROTOCOL_VERSION,
  RunnerCancellationResponseSchema,
  RunnerEventBatchResponseSchema,
  RunnerHeartbeatResponseSchema,
  RunnerLeaseResponseSchema,
  RunnerPairingPollResponseSchema,
  RunnerPairingStartResponseSchema,
} from "@llm-bench/contracts";

import type { BufferedEvent } from "./event-buffer";
import type { RunnerTransport } from "./worker";

type Fetch = (request: Request) => Promise<Response>;

export class RunnerHttpTransport implements RunnerTransport {
  private readonly serverUrl: string;
  private readonly token: string;
  private readonly fetch: Fetch;

  constructor(options: { serverUrl: string; token: string; fetch?: Fetch }) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async heartbeat(): Promise<void> {
    const response = await this.request("heartbeat", {
      method: "POST",
      body: { protocolVersion: RUNNER_PROTOCOL_VERSION, status: "online" },
    });
    RunnerHeartbeatResponseSchema.parse(await response.json());
  }

  async lease(): Promise<RunnerLease | null> {
    const response = await this.request("lease", {
      method: "POST",
      body: { protocolVersion: RUNNER_PROTOCOL_VERSION },
    });
    return RunnerLeaseResponseSchema.parse(await response.json()).lease;
  }

  async recordEvents(
    lease: RunnerLease,
    events: BufferedEvent[],
  ): Promise<{ throughSequence: number }> {
    const response = await this.request("events", {
      method: "POST",
      body: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        events,
      },
    });
    return RunnerEventBatchResponseSchema.parse(await response.json());
  }

  async saveCheckpoint(
    lease: RunnerLease,
    checkpoint: RunnerCheckpoint,
  ): Promise<void> {
    await this.request("checkpoints", {
      method: "POST",
      body: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        checkpoint,
      },
    });
  }

  async cancellationStatus(lease: RunnerLease) {
    const query = new URLSearchParams({
      attemptId: lease.attemptId,
      leaseToken: lease.leaseToken,
    });
    const response = await this.request(`cancellation?${query.toString()}`, {
      method: "GET",
    });
    return RunnerCancellationResponseSchema.parse(await response.json());
  }

  async complete(
    lease: RunnerLease,
    terminal: Parameters<RunnerTransport["complete"]>[1],
  ): Promise<void> {
    await this.request("completion", {
      method: "POST",
      body: {
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        ...terminal,
      },
    });
  }

  async logout(runnerId: string): Promise<void> {
    await this.request(`runners/${runnerId}/revoke`, { method: "POST" });
  }

  private async request(
    path: string,
    options: { method: string; body?: unknown },
  ): Promise<Response> {
    const response = await this.fetch(
      new Request(`${this.serverUrl}/api/v1/runner/${path}`, {
        method: options.method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        payload?.error ?? `Runner API failed (${response.status}).`,
      );
    }
    return response;
  }
}

export async function startRunnerPairing(
  options: {
    serverUrl: string;
    name: string;
    publicKey: string;
    capabilities: ("workspaces" | "files")[];
    environment: RunnerEnvironment;
  },
  fetch: Fetch = globalThis.fetch,
): Promise<RunnerPairingStartResponse> {
  const serverUrl = options.serverUrl.replace(/\/$/, "");
  const response = await fetch(
    new Request(`${serverUrl}/api/v1/runner/pairings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        name: options.name,
        publicKey: options.publicKey,
        capabilities: options.capabilities,
        environment: options.environment,
      }),
    }),
  );
  if (!response.ok) throw new Error(`Pairing failed (${response.status}).`);
  return RunnerPairingStartResponseSchema.parse(await response.json());
}

export async function pollRunnerPairing(
  serverUrl: string,
  deviceCode: string,
  fetch: Fetch = globalThis.fetch,
): Promise<RunnerPairingPollResponse> {
  const response = await fetch(
    new Request(
      `${serverUrl.replace(/\/$/, "")}/api/v1/runner/pairings/${encodeURIComponent(deviceCode)}`,
    ),
  );
  if (!response.ok)
    throw new Error(`Pairing poll failed (${response.status}).`);
  return RunnerPairingPollResponseSchema.parse(await response.json());
}
