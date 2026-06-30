import type { FixtureHarness } from "@llm-bench/runner-engine";

import { KNOWN_PATCH, MODULE_PATH } from "./fixture";

/**
 * Deterministic fixture harnesses for the clamp repair task. These stand in for
 * a model-backed harness in later epics: each one mutates the workspace in a
 * fixed way and reports a trajectory, with no network or model involved.
 */

/** Writes the given source over the module under repair. */
export function createPatchHarness(source: string): FixtureHarness {
  return {
    repair: async ({ workspace }) => {
      await workspace.writeFile(MODULE_PATH, source);
      return { trajectory: [`read ${MODULE_PATH}`, `edit ${MODULE_PATH}`] };
    },
  };
}

/** The canonical harness that applies the known good patch. */
export function knownPatchHarness(): FixtureHarness {
  return createPatchHarness(KNOWN_PATCH);
}

/** A harness that inspects the project but changes nothing. */
export function noChangeHarness(): FixtureHarness {
  return {
    repair: () => Promise.resolve({ trajectory: [`read ${MODULE_PATH}`] }),
  };
}
