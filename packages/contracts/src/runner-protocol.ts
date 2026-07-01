import { z } from "zod";

import { CapabilitySchema } from "./capability";
import { BenchmarkEventSchema } from "./events";
import { MetricObservationSchema } from "./metric";

export const RUNNER_PROTOCOL_VERSION = "1.0" as const;

export const RunnerEnvironmentSchema = z.strictObject({
  os: z.enum(["darwin", "linux"]),
  architecture: z.string().min(1),
  cpuClass: z.string().min(1),
  memoryMb: z.number().int().positive(),
  runtimeVersions: z.record(z.string(), z.string()),
  harnessVersions: z.record(z.string(), z.string()),
  sandboxMode: z.string().min(1),
  contentHashes: z.record(z.string(), z.string()),
});

export const RunnerPairingStartRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  name: z.string().trim().min(1).max(100),
  publicKey: z.string().min(1),
  capabilities: z.array(CapabilitySchema),
  environment: RunnerEnvironmentSchema,
});

export const RunnerPairingStartResponseSchema = z.strictObject({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.url(),
  expiresAt: z.iso.datetime(),
  intervalSeconds: z.number().int().positive(),
});

export const RunnerPairingPollResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("pending") }),
  z.strictObject({
    status: z.literal("approved"),
    runnerId: z.uuid(),
    token: z.string().min(1),
  }),
]);

export const RunnerHeartbeatRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  status: z.literal("online"),
});

export const RunnerHeartbeatResponseSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  serverTime: z.iso.datetime(),
});

export const RunnerCheckpointSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  resumable: z.boolean(),
  state: z.record(z.string(), z.unknown()),
});

export const RunnerLeaseSchema = z.strictObject({
  jobId: z.uuid(),
  attemptId: z.uuid(),
  leaseToken: z.string().min(1),
  benchmark: z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  queuePosition: z.number().int().nonnegative(),
  checkpoint: RunnerCheckpointSchema.nullable(),
  cancellationRequested: z.boolean(),
});

export const RunnerLeaseResponseSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  lease: RunnerLeaseSchema.nullable(),
});

export const RunnerLeaseRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
});

export const RunnerEventBatchRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  attemptId: z.uuid(),
  leaseToken: z.string().min(1),
  events: z
    .array(
      z.strictObject({
        sequence: z.number().int().nonnegative(),
        event: BenchmarkEventSchema,
      }),
    )
    .min(1),
});

export const RunnerEventBatchResponseSchema = z.strictObject({
  throughSequence: z.number().int().nonnegative(),
});

export const RunnerCheckpointRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  attemptId: z.uuid(),
  leaseToken: z.string().min(1),
  checkpoint: RunnerCheckpointSchema,
});

export const RunnerCancellationResponseSchema = z.strictObject({
  cancellationRequested: z.boolean(),
});

export const RunnerArtifactReferenceSchema = z.strictObject({
  kind: z.string().min(1),
  blobPath: z.string().min(1),
  contentHash: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
});

export const RunnerTerminalRequestSchema = z.strictObject({
  protocolVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  attemptId: z.uuid(),
  leaseToken: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled", "interrupted"]),
  observations: z.array(MetricObservationSchema),
  artifacts: z.array(RunnerArtifactReferenceSchema),
  error: z.record(z.string(), z.unknown()).nullable(),
});

export type RunnerCheckpoint = z.infer<typeof RunnerCheckpointSchema>;
export type RunnerEnvironment = z.infer<typeof RunnerEnvironmentSchema>;
export type RunnerPairingStartRequest = z.infer<
  typeof RunnerPairingStartRequestSchema
>;
export type RunnerPairingStartResponse = z.infer<
  typeof RunnerPairingStartResponseSchema
>;
export type RunnerPairingPollResponse = z.infer<
  typeof RunnerPairingPollResponseSchema
>;
export type RunnerLease = z.infer<typeof RunnerLeaseSchema>;
export type RunnerLeaseResponse = z.infer<typeof RunnerLeaseResponseSchema>;
export type RunnerEventBatchRequest = z.infer<
  typeof RunnerEventBatchRequestSchema
>;
export type RunnerArtifactReference = z.infer<
  typeof RunnerArtifactReferenceSchema
>;
export type RunnerTerminalRequest = z.infer<typeof RunnerTerminalRequestSchema>;
