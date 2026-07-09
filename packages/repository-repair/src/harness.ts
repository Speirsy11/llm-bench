import type { FixtureHarness } from "@llm-bench/runner-engine";

import type { RepairFixtureId } from "./fixture";
import {
  DEFAULT_FIXTURE_ID,
  KNOWN_PATCH,
  MODULE_PATH,
  repairFixture,
} from "./fixture";

/**
 * Deterministic fixture harnesses for the clamp repair task. These stand in for
 * a model-backed harness in later epics: each one mutates the workspace in a
 * fixed way and reports a trajectory, with no network or model involved.
 */

/** Writes the given source over the module under repair. */
export function createPatchHarness(source: string): FixtureHarness;
export function createPatchHarness(
  fixtureId: RepairFixtureId,
  source: string,
): FixtureHarness;
export function createPatchHarness(
  fixtureOrSource: string,
  maybeSource?: string,
): FixtureHarness {
  const fixtureId =
    maybeSource === undefined
      ? DEFAULT_FIXTURE_ID
      : (fixtureOrSource as RepairFixtureId);
  const source = maybeSource ?? fixtureOrSource;
  const modulePath = modulePathFor(fixtureId);
  return {
    repair: async ({ workspace }) => {
      await workspace.writeFile(modulePath, source);
      return { trajectory: [`read ${modulePath}`, `edit ${modulePath}`] };
    },
  };
}

/** The canonical harness that applies the known good patch. */
export function knownPatchHarness(
  fixtureId: RepairFixtureId = DEFAULT_FIXTURE_ID,
): FixtureHarness {
  const source =
    fixtureId === DEFAULT_FIXTURE_ID
      ? KNOWN_PATCH
      : repairFixture(fixtureId).knownPatch;
  return createPatchHarness(fixtureId, source);
}

/** A harness that inspects the project but changes nothing. */
export function noChangeHarness(
  fixtureId: RepairFixtureId = DEFAULT_FIXTURE_ID,
): FixtureHarness {
  const modulePath = modulePathFor(fixtureId);
  return {
    repair: () => Promise.resolve({ trajectory: [`read ${modulePath}`] }),
  };
}

function modulePathFor(fixtureId: RepairFixtureId): string {
  return fixtureId === DEFAULT_FIXTURE_ID
    ? MODULE_PATH
    : repairFixture(fixtureId).modulePath;
}
