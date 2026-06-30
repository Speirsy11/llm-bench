import { z } from "zod";

import { CapabilitySchema } from "./capability";
import { MetricObservationSchema } from "./metric";

/**
 * Discriminated event and failure unions reported during a job, plus checkpoint
 * and artifact records. Timestamps are ISO-8601 strings so events serialize
 * without a clock dependency.
 */

export const FailureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("incompatible_capabilities"),
    missing: z.array(CapabilitySchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("timeout"),
    limitMs: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("harness_error"),
    message: z.string().min(1),
  }),
]);
export type Failure = z.infer<typeof FailureSchema>;

export const BenchmarkEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("job_started"),
    at: z.iso.datetime(),
    jobId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("case_completed"),
    at: z.iso.datetime(),
    caseId: z.string().min(1),
    observations: z.array(MetricObservationSchema),
  }),
  z.strictObject({
    type: z.literal("job_failed"),
    at: z.iso.datetime(),
    failure: FailureSchema,
  }),
]);
export type BenchmarkEvent = z.infer<typeof BenchmarkEventSchema>;

export const CheckpointSchema = z.strictObject({
  jobId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  resumable: z.boolean(),
  state: z.record(z.string(), z.unknown()),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ArtifactSchema = z.strictObject({
  id: z.string().min(1),
  jobId: z.string().min(1),
  contentHash: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
});
export type Artifact = z.infer<typeof ArtifactSchema>;
