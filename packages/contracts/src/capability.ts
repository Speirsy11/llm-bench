import { z } from "zod";

/**
 * Harness capabilities advertised by a manifest and required by a benchmark.
 * Unsupported combinations are rejected before a paid model call.
 */

export const capabilities = [
  "response_generation",
  "workspaces",
  "files",
  "shell",
  "structured_output",
  "streaming",
  "session_resume",
  "mcp",
  "usage_reporting",
] as const;

export const CapabilitySchema = z.enum(capabilities);
export type Capability = z.infer<typeof CapabilitySchema>;

export type CompatibilityResult =
  | { compatible: true }
  | { compatible: false; missing: Capability[] };

/**
 * Compares the capabilities a benchmark requires against those a harness
 * advertises. Returns a typed failure listing every missing capability.
 */
export function evaluateCompatibility(
  required: Capability[],
  advertised: Capability[],
): CompatibilityResult {
  const advertisedSet = new Set(advertised);
  const missing = required.filter(
    (capability) => !advertisedSet.has(capability),
  );
  if (missing.length > 0) {
    return { compatible: false, missing };
  }
  return { compatible: true };
}
