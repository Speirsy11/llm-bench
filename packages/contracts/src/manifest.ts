import { z } from "zod";

import { CapabilitySchema } from "./capability";
import { MetricDefinitionSchema } from "./metric";

/**
 * Benchmark and harness manifests. A benchmark advertises its required
 * capabilities and the metrics it reports; a harness advertises the
 * capabilities it supports and the model routes it can drive.
 *
 * Performance benchmarks are deferred to a later epic, so the v1 contract
 * recognises only the `response` and `agentic` kinds.
 */

export const benchmarkKinds = ["response", "agentic"] as const;
export const BenchmarkKindSchema = z.enum(benchmarkKinds);
export type BenchmarkKind = z.infer<typeof BenchmarkKindSchema>;

export const BenchmarkManifestSchema = z
  .strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    kind: BenchmarkKindSchema,
    primaryMetricId: z.string().min(1),
    metrics: z.array(MetricDefinitionSchema).min(1),
    requiredCapabilities: z.array(CapabilitySchema),
  })
  .refine(
    (manifest) =>
      manifest.metrics.some((metric) => metric.id === manifest.primaryMetricId),
    {
      error: "primaryMetricId must reference a defined metric.",
      path: ["primaryMetricId"],
    },
  );
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

export const ModelRouteSchema = z.strictObject({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;

export const ToolsetSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  tools: z.array(z.string().min(1)),
  mcpProfiles: z.array(z.string().min(1)),
});
export type Toolset = z.infer<typeof ToolsetSchema>;

export const LimitsSchema = z.strictObject({
  maxDurationMs: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxTokens: z.number().int().positive(),
  maxTurns: z.number().int().positive().optional(),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const HarnessManifestSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(CapabilitySchema),
  modelRoutes: z.array(ModelRouteSchema),
});
export type HarnessManifest = z.infer<typeof HarnessManifestSchema>;
