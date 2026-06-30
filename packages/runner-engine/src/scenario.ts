import type { AgenticBenchmark, AgenticTask } from "@llm-bench/contracts";

import type { HiddenTest } from "./grader";
import type { Workspace } from "./workspace";

/**
 * A self-contained agentic repair scenario the engine can run without a server.
 * `prepare` writes the visible, broken project into a fresh workspace; the
 * hidden tests are withheld until after the harness finishes.
 */
export interface RepairScenario {
  benchmark: AgenticBenchmark;
  task: AgenticTask;
  prepare(workspace: Workspace): Promise<void>;
  hiddenTests: HiddenTest[];
}

/** The bounded context a harness is given to attempt a repair. */
export interface HarnessContext {
  workspace: Workspace;
  signal: AbortSignal;
}

/** What a harness reports about its own run, independent of grading. */
export interface HarnessOutcome {
  trajectory: string[];
}

/**
 * A deterministic executable harness. Concrete model-backed harnesses arrive in
 * later epics; here a harness simply mutates the workspace and reports a
 * trajectory, honouring the abort signal for cancellation and timeout.
 */
export interface FixtureHarness {
  repair(context: HarnessContext): Promise<HarnessOutcome>;
}

/**
 * Type-only module: it declares the scenario and harness contracts the engine
 * consumes and emits no runtime code. See `vitest.config.ts`, where it is a
 * documented coverage exclusion alongside barrels and test files.
 */
export {};
