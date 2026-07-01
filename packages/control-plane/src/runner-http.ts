import { ZodError } from "zod";

import {
  RUNNER_PROTOCOL_VERSION,
  RunnerCheckpointRequestSchema,
  RunnerEventBatchRequestSchema,
  RunnerHeartbeatRequestSchema,
  RunnerLeaseRequestSchema,
  RunnerPairingStartRequestSchema,
  RunnerTerminalRequestSchema,
} from "@llm-bench/contracts";

import type { createRunnerJobService } from "./runner-jobs";
import type { createRunnerProtocolService } from "./runner-protocol";

type ProtocolService = ReturnType<typeof createRunnerProtocolService>;
type JobService = ReturnType<typeof createRunnerJobService>;

export function createRunnerHttpHandler({
  protocol,
  jobs,
  baseUrl,
  now = () => new Date(),
}: {
  protocol: ProtocolService;
  jobs: JobService;
  baseUrl: string;
  now?: () => Date;
}) {
  return async (request: Request, path: string[]): Promise<Response> => {
    try {
      if (request.method === "POST" && path.join("/") === "pairings") {
        const input = RunnerPairingStartRequestSchema.parse(
          await request.json(),
        );
        const pairing = await protocol.startPairing(input);
        return json(
          {
            ...pairing,
            verificationUri: `${baseUrl}/dashboard/runners/pair`,
            expiresAt: pairing.expiresAt.toISOString(),
          },
          201,
        );
      }
      if (request.method === "GET" && path[0] === "pairings" && path[1]) {
        return json(await protocol.pollPairing(path[1]));
      }

      const runner = await authenticate(request, protocol);
      if (request.method === "POST" && path.join("/") === "heartbeat") {
        RunnerHeartbeatRequestSchema.parse(await request.json());
        await protocol.heartbeat(runner);
        return json({
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          serverTime: now().toISOString(),
        });
      }
      if (request.method === "POST" && path.join("/") === "lease") {
        RunnerLeaseRequestSchema.parse(await request.json());
        return json({
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          lease: await jobs.lease(runner),
        });
      }
      if (request.method === "POST" && path.join("/") === "events") {
        const input = RunnerEventBatchRequestSchema.parse(await request.json());
        return json(await jobs.recordEvents(runner, input));
      }
      if (request.method === "POST" && path.join("/") === "completion") {
        const input = RunnerTerminalRequestSchema.parse(await request.json());
        await jobs.complete(runner, input);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && path.join("/") === "checkpoints") {
        const input = RunnerCheckpointRequestSchema.parse(await request.json());
        await jobs.saveCheckpoint(runner, input);
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && path.join("/") === "cancellation") {
        const url = new URL(request.url);
        const attemptId = url.searchParams.get("attemptId");
        const leaseToken = url.searchParams.get("leaseToken");
        if (!attemptId || !leaseToken)
          throw new Error("Attempt lease is required.");
        return json(
          await jobs.cancellationStatus(runner, { attemptId, leaseToken }),
        );
      }
      if (
        request.method === "POST" &&
        path[0] === "runners" &&
        path[1] === runner.id &&
        path[2] === "revoke"
      ) {
        await protocol.revokeAuthenticated(runner);
        return new Response(null, { status: 204 });
      }
      return json({ error: "Runner endpoint not found." }, 404);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid request.";
      if (message === "Runner authentication failed.") {
        return json({ error: message }, 401);
      }
      if (isExpectedRunnerError(error)) {
        return json({ error: message }, 400);
      }
      return json({ error: "Runner request failed." }, 500);
    }
  };
}

async function authenticate(request: Request, protocol: ProtocolService) {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!match?.[1]) throw new Error("Runner authentication failed.");
  return protocol.authenticate(match[1]);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function isExpectedRunnerError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  if (!(error instanceof Error)) return false;
  if (error instanceof SyntaxError) return true;
  return [
    "Attempt lease is required.",
    "Attempt lease is unavailable.",
    "Attempt is already terminal.",
    "Checkpoint sequence must advance.",
    "Job is unavailable.",
    "Pairing code has already been approved.",
    "Pairing code has already been consumed.",
    "Pairing code has expired.",
    "Pairing code is invalid.",
    "Paired runner is unavailable.",
  ].includes(error.message);
}
