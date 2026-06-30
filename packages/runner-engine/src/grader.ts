import type { Workspace } from "./workspace";

/**
 * A single hidden behavioural test, injected only after the harness has
 * finished. Its `run` inspects the repaired workspace and resolves to whether
 * the behaviour is correct; a thrown error counts as a failing test.
 */
export interface HiddenTest {
  id: string;
  run(workspace: Workspace): Promise<boolean>;
}

export interface GradeResult {
  total: number;
  passed: number;
  ratio: number;
  passedIds: string[];
  failedIds: string[];
}

/**
 * Runs hidden tests against the repaired workspace and returns the pass ratio.
 * The ratio is derived purely from the hidden tests, independent of any signal
 * the harness reported about its own success.
 */
export async function gradeHiddenTests(
  workspace: Workspace,
  tests: HiddenTest[],
): Promise<GradeResult> {
  const passedIds: string[] = [];
  const failedIds: string[] = [];
  for (const test of tests) {
    const passed = await test.run(workspace).catch(() => false);
    (passed ? passedIds : failedIds).push(test.id);
  }
  const total = tests.length;
  const passed = passedIds.length;
  return {
    total,
    passed,
    ratio: total === 0 ? 0 : passed / total,
    passedIds,
    failedIds,
  };
}
