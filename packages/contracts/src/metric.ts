import { z } from "zod";

/**
 * Typed metrics. LLMBench does not force a universal score: every metric
 * declares its kind, unit, and ranking direction, and a benchmark nominates one
 * primary metric. Missing data is represented as a `null` observation value.
 */

export const metricKinds = [
  "ratio",
  "duration",
  "rate",
  "count",
  "tokens",
  "currency",
  "bytes",
] as const;

export const MetricKindSchema = z.enum(metricKinds);
export type MetricKind = z.infer<typeof MetricKindSchema>;

export const metricDirections = [
  "higher_is_better",
  "lower_is_better",
] as const;

export const MetricDirectionSchema = z.enum(metricDirections);
export type MetricDirection = z.infer<typeof MetricDirectionSchema>;

export const MetricDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: MetricKindSchema,
  unit: z.string().min(1),
  direction: MetricDirectionSchema,
});
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

export const MetricObservationSchema = z.strictObject({
  metricId: z.string().min(1),
  /** `null` records that a value is missing rather than zero. */
  value: z.number().nullable(),
});
export type MetricObservation = z.infer<typeof MetricObservationSchema>;

/** Whether `candidate` ranks above `incumbent` for the metric's direction. */
export function isBetterValue(
  direction: MetricDirection,
  candidate: number,
  incumbent: number,
): boolean {
  return direction === "higher_is_better"
    ? candidate > incumbent
    : candidate < incumbent;
}

/**
 * Best observation by ranking direction, skipping missing data. Returns `null`
 * when no observation carries a value.
 */
export function selectBestObservation(
  direction: MetricDirection,
  observations: MetricObservation[],
): MetricObservation | null {
  let best: MetricObservation | null = null;
  let bestValue: number | null = null;
  for (const observation of observations) {
    if (observation.value === null) {
      continue;
    }
    if (
      bestValue === null ||
      isBetterValue(direction, observation.value, bestValue)
    ) {
      best = observation;
      bestValue = observation.value;
    }
  }
  return best;
}

/** The metric definition nominated as primary, or throws if undefined. */
export function selectPrimaryMetric(
  definitions: MetricDefinition[],
  primaryMetricId: string,
): MetricDefinition {
  const found = definitions.find(
    (definition) => definition.id === primaryMetricId,
  );
  if (found === undefined) {
    throw new Error(`Primary metric "${primaryMetricId}" is not defined.`);
  }
  return found;
}
