import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { HiddenTest } from "./grader";
import { gradeHiddenTests } from "./grader";
import { Workspace } from "./workspace";

describe("gradeHiddenTests", () => {
  const opened: Workspace[] = [];

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((workspace) => workspace.cleanup()));
  });

  async function workspace(): Promise<Workspace> {
    const created = await Workspace.create(tmpdir());
    opened.push(created);
    return created;
  }

  function test(id: string, result: boolean): HiddenTest {
    return { id, run: () => Promise.resolve(result) };
  }

  it("reports a full ratio when every hidden test passes", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      test("b", true),
    ]);

    expect(grade).toEqual({
      total: 2,
      passed: 2,
      ratio: 1,
      passedIds: ["a", "b"],
      failedIds: [],
    });
  });

  it("reports an independent partial ratio for an incomplete repair", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      test("b", false),
      test("c", true),
      test("d", false),
    ]);

    // 2 of 4 is an independent literal, not recomputed from the code.
    expect(grade.ratio).toBe(0.5);
    expect(grade.passedIds).toEqual(["a", "c"]);
    expect(grade.failedIds).toEqual(["b", "d"]);
  });

  it("counts a hidden test that throws as failed rather than crashing", async () => {
    const grade = await gradeHiddenTests(await workspace(), [
      test("a", true),
      {
        id: "explodes",
        run: () => Promise.reject(new Error("module did not import")),
      },
    ]);

    expect(grade.passed).toBe(1);
    expect(grade.failedIds).toEqual(["explodes"]);
  });

  it("reports a zero ratio when there are no hidden tests", async () => {
    const grade = await gradeHiddenTests(await workspace(), []);

    expect(grade).toEqual({
      total: 0,
      passed: 0,
      ratio: 0,
      passedIds: [],
      failedIds: [],
    });
  });
});
