import { createRequire } from "node:module";

import type { AgenticTask } from "@llm-bench/contracts";
import type {
  HiddenTest,
  RepairScenario,
  Workspace,
} from "@llm-bench/runner-engine";
import { AgenticBenchmark } from "@llm-bench/contracts";

/**
 * A single TypeScript repository-repair fixture: a deliberately broken `clamp`
 * implementation, the known good patch, an incomplete patch, and hidden
 * behavioural tests. The visible project is written into the workspace; the
 * hidden tests are withheld until grading and execute the repaired module
 * directly, so the pass ratio reflects real behaviour rather than a self-report.
 */

/** Workspace-relative path of the module under repair. */
export const MODULE_PATH = "src/clamp.cjs";

/** Broken implementation: the bounds are ignored entirely. */
export const BROKEN_SOURCE = `function clamp(value, lower, upper) {
  // BUG: returns the input unchanged, ignoring the bounds.
  return value;
}
module.exports = { clamp };
`;

/** Known good patch: clamps to both the lower and upper bound. */
export const KNOWN_PATCH = `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}
module.exports = { clamp };
`;

/** Incomplete patch: clamps the lower bound but forgets the upper bound. */
export const PARTIAL_PATCH = `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  return value;
}
module.exports = { clamp };
`;

/** Visible specification the agent sees while attempting the repair. */
export const VISIBLE_SPEC = `clamp(value, lower, upper) must return:
- lower when value < lower
- upper when value > upper
- value otherwise
`;

const TASK: AgenticTask = {
  id: "clamp-bounds",
  language: "typescript",
  constraints: ["Do not modify the hidden tests.", "Keep the clamp signature."],
  repetitions: 1,
};

export class ClampRepairBenchmark extends AgenticBenchmark {
  tasks(): AgenticTask[] {
    return [TASK];
  }
}

function clampBenchmark(): ClampRepairBenchmark {
  return new ClampRepairBenchmark({
    id: "repository-repair",
    version: "1.0.0",
    kind: "agentic",
    primaryMetricId: "hidden_test_pass_ratio",
    metrics: [
      {
        id: "hidden_test_pass_ratio",
        label: "Hidden test pass ratio",
        kind: "ratio",
        unit: "ratio",
        direction: "higher_is_better",
      },
      {
        id: "duration_ms",
        label: "Duration",
        kind: "duration",
        unit: "ms",
        direction: "lower_is_better",
      },
    ],
    requiredCapabilities: ["workspaces", "files"],
  });
}

type Clamp = (value: number, lower: number, upper: number) => number;

const requireModule = createRequire(import.meta.url);

/**
 * Loads the repaired module to exercise its real behaviour.
 *
 * SECURITY: this runs in-process. That is acceptable here because the only code
 * written into the workspace is this package's own first-party fixture source
 * (see the harnesses in `./harness`) — no model-authored or otherwise untrusted
 * code is executed in this epic, and there are no real model calls yet. When a
 * real harness later produces patches from model output, that code MUST run
 * behind the runner's process/sandbox boundary (EPIC-05+) rather than being
 * required into the engine process.
 */
async function loadClamp(workspace: Workspace): Promise<Clamp> {
  const modulePath = await workspace.resolve(MODULE_PATH);
  const loaded = requireModule(modulePath) as { clamp: Clamp };
  return loaded.clamp;
}

const HIDDEN_TESTS: HiddenTest[] = [
  {
    id: "in-range",
    run: async (workspace) => (await loadClamp(workspace))(5, 0, 10) === 5,
  },
  {
    id: "below-lower",
    run: async (workspace) => (await loadClamp(workspace))(-3, 0, 10) === 0,
  },
  {
    id: "above-upper",
    run: async (workspace) => (await loadClamp(workspace))(15, 0, 10) === 10,
  },
];

/** The runnable repair scenario consumed by the local execution engine. */
export function repairScenario(): RepairScenario {
  return {
    benchmark: clampBenchmark(),
    task: TASK,
    prepare: async (workspace) => {
      await workspace.writeFile(MODULE_PATH, BROKEN_SOURCE);
      await workspace.writeFile("SPEC.md", VISIBLE_SPEC);
    },
    hiddenTests: HIDDEN_TESTS,
  };
}
