import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ExecutionResult, FixtureHarness } from "@llm-bench/runner-engine";
import {
  executeAgenticTask,
  FileArtifactStore,
  JsonlEventSpool,
} from "@llm-bench/runner-engine";

import type { RepairFixtureId } from "./fixture";
import {
  PARTIAL_PATCH,
  repairCorpusSample,
  repairFixture,
  repairFixtures,
  repairScenario,
  summarizeRepairCorpus,
} from "./fixture";
import {
  createPatchHarness,
  knownPatchHarness,
  noChangeHarness,
} from "./harness";

describe("clamp repository-repair fixture", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function run(
    harness: FixtureHarness,
    fixtureId?: RepairFixtureId,
  ): Promise<ExecutionResult> {
    const root = await mkdtemp(path.join(tmpdir(), "repair-"));
    roots.push(root);
    return executeAgenticTask({
      jobId: "job-1",
      scenario: repairScenario(fixtureId),
      harness,
      limits: { maxDurationMs: 60_000, maxToolCalls: 10, maxTokens: 1_000 },
      workspaceRoot: root,
      artifactStore: new FileArtifactStore(path.join(root, "artifacts")),
      eventSpool: new JsonlEventSpool(path.join(root, "events.jsonl")),
    });
  }

  it("fails the hidden tests while the fixture is still broken", async () => {
    const result = await run(noChangeHarness());

    expect(result.status).toBe("completed");
    expect(result.grade?.passed).toBe(1);
    expect(result.grade?.total).toBe(3);
    expect(result.grade?.passedIds).toEqual(["in-range"]);
    expect(result.grade?.failedIds).toEqual(["below-lower", "above-upper"]);
  });

  it("passes every hidden test once the known patch is applied", async () => {
    const result = await run(knownPatchHarness());

    expect(result.status).toBe("completed");
    expect(result.grade?.ratio).toBe(1);
    expect(result.observations).toEqual([
      { metricId: "hidden_test_pass_ratio", value: 1 },
    ]);
  });

  it("detects an incomplete patch through the hidden tests", async () => {
    const result = await run(createPatchHarness(PARTIAL_PATCH));

    expect(result.status).toBe("completed");
    // The partial patch clamps the lower bound only: 2 of 3 hidden tests pass.
    expect(result.grade?.passed).toBe(2);
    expect(result.grade?.failedIds).toEqual(["above-upper"]);
  });

  it("captures the repair as a diff of the module under repair", async () => {
    const result = await run(knownPatchHarness());

    expect(result.diff.changedPaths).toEqual(["src/clamp.cjs"]);
    expect(result.diff.entries[0]?.after).toContain("if (value > upper)");
    expect(result.diffArtifact.mediaType).toBe("text/x-diff");
  });

  it("deletes the workspace after the run completes", async () => {
    const result = await run(knownPatchHarness());

    expect(result.cleanedUp).toBe(true);
  });

  it("exposes the selected agentic task through the scenario", () => {
    const scenario = repairScenario();

    expect(scenario.task.id).toBe("typescript-clamp-bounds");
    expect(scenario.task.language).toBe("typescript");
    expect(scenario.benchmark.tasks()).toContainEqual(scenario.task);
  });

  it("prepares visible test files without exposing hidden graders", async () => {
    const inspected: {
      fixtureId: RepairFixtureId;
      files: string[];
      visibleTestPath: string;
    }[] = [];

    for (const fixture of repairFixtures()) {
      await run(
        {
          repair: async ({ workspace }) => {
            inspected.push({
              fixtureId: fixture.id,
              files: await workspace.list(),
              visibleTestPath: fixture.visibleTestPath,
            });
            return { trajectory: [`read ${fixture.visibleTestPath}`] };
          },
        },
        fixture.id,
      );
    }

    expect(inspected).toHaveLength(6);
    for (const prepared of inspected) {
      expect(prepared.files).toContain("SPEC.md");
      expect(prepared.files).toContain(prepared.visibleTestPath);
      expect(prepared.files.some((file) => file.includes("hidden"))).toBe(
        false,
      );
    }
  });

  it("grades the async cache fixture across broken, known, and incomplete repairs", async () => {
    const fixture = repairFixture("typescript-async-cache");

    const broken = await run(noChangeHarness(), fixture.id);
    expect(broken.status).toBe("completed");
    expect(broken.grade).toMatchObject({
      passed: 1,
      total: 3,
      passedIds: ["failed-loads-are-not-cached"],
      failedIds: [
        "sequential-hit-reuses-loader",
        "concurrent-hit-shares-loader",
      ],
    });

    const known = await run(knownPatchHarness(fixture.id), fixture.id);
    expect(known.grade?.ratio).toBe(1);

    const incomplete = await run(
      createPatchHarness(fixture.id, fixture.incompletePatch),
      fixture.id,
    );
    expect(incomplete.grade).toMatchObject({
      passed: 2,
      failedIds: ["concurrent-hit-shares-loader"],
    });
  });

  it("grades the state reducer fixture across broken, known, and incomplete repairs", async () => {
    const fixture = repairFixture("typescript-state-reducer");

    const broken = await run(noChangeHarness(), fixture.id);
    expect(broken.grade).toMatchObject({
      passed: 0,
      total: 3,
      failedIds: [
        "add-event-is-immutable",
        "remove-event-is-immutable",
        "unknown-event-clones-state",
      ],
    });

    const known = await run(
      createPatchHarness(fixture.id, fixture.knownPatch),
      fixture.id,
    );
    expect(known.grade?.ratio).toBe(1);

    const incomplete = await run(
      createPatchHarness(fixture.id, fixture.incompletePatch),
      fixture.id,
    );
    expect(incomplete.grade).toMatchObject({
      passed: 1,
      failedIds: ["remove-event-is-immutable", "unknown-event-clones-state"],
    });
  });

  it("grades the Python duration parser across broken, known, and incomplete repairs", async () => {
    const fixture = repairFixture("python-parse-duration");

    const broken = await run(noChangeHarness(), fixture.id);
    expect(broken.grade).toMatchObject({
      passed: 1,
      total: 3,
      passedIds: ["milliseconds-and-bare-values"],
      failedIds: [
        "seconds-convert-to-ms",
        "minutes-and-decimals-convert-to-ms",
      ],
    });

    const known = await run(
      createPatchHarness(fixture.id, fixture.knownPatch),
      fixture.id,
    );
    expect(known.grade?.ratio).toBe(1);

    const incomplete = await run(
      createPatchHarness(fixture.id, fixture.incompletePatch),
      fixture.id,
    );
    expect(incomplete.grade).toMatchObject({
      passed: 2,
      failedIds: ["minutes-and-decimals-convert-to-ms"],
    });
  });

  it("grades the Python API boundary fixture across broken, known, and incomplete repairs", async () => {
    const fixture = repairFixture("python-api-boundary");

    const broken = await run(noChangeHarness(), fixture.id);
    expect(broken.grade).toMatchObject({
      passed: 1,
      total: 3,
      passedIds: ["input-user-is-not-mutated"],
      failedIds: [
        "only-public-fields-cross-boundary",
        "display-name-falls-back-to-username",
      ],
    });

    const known = await run(
      createPatchHarness(fixture.id, fixture.knownPatch),
      fixture.id,
    );
    expect(known.grade?.ratio).toBe(1);

    const incomplete = await run(
      createPatchHarness(fixture.id, fixture.incompletePatch),
      fixture.id,
    );
    expect(incomplete.grade).toMatchObject({
      passed: 1,
      failedIds: [
        "only-public-fields-cross-boundary",
        "display-name-falls-back-to-username",
      ],
    });
  });

  it("grades the Python resource cleanup fixture across broken, known, and incomplete repairs", async () => {
    const fixture = repairFixture("python-resource-cleanup");

    const broken = await run(noChangeHarness(), fixture.id);
    expect(broken.grade).toMatchObject({
      passed: 1,
      total: 3,
      passedIds: ["copies-trimmed-lines"],
      failedIds: [
        "closes-files-after-success",
        "closes-files-when-write-fails",
      ],
    });

    const known = await run(
      createPatchHarness(fixture.id, fixture.knownPatch),
      fixture.id,
    );
    expect(known.grade?.ratio).toBe(1);

    const incomplete = await run(
      createPatchHarness(fixture.id, fixture.incompletePatch),
      fixture.id,
    );
    expect(incomplete.grade).toMatchObject({
      passed: 1,
      failedIds: [
        "closes-files-after-success",
        "closes-files-when-write-fails",
      ],
    });
  });
});

describe("repository-repair corpus catalog", () => {
  it("exposes a balanced TypeScript and Python fixture catalog", () => {
    const fixtures = repairFixtures();

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      "typescript-clamp-bounds",
      "typescript-async-cache",
      "typescript-state-reducer",
      "python-parse-duration",
      "python-api-boundary",
      "python-resource-cleanup",
    ]);
    expect(
      fixtures.filter((fixture) => fixture.language === "typescript"),
    ).toHaveLength(3);
    expect(
      fixtures.filter((fixture) => fixture.language === "python"),
    ).toHaveLength(3);
    expect(new Set(fixtures.map((fixture) => fixture.contentHash)).size).toBe(
      6,
    );
    expect(new Set(fixtures.map((fixture) => fixture.graderHash)).size).toBe(6);
    for (const fixture of fixtures) {
      expect(fixture.contentHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(fixture.graderHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(fixtures.map((fixture) => fixture.runtime)).toEqual([
      { kind: "node", version: ">=22", offline: true },
      { kind: "node", version: ">=22", offline: true },
      { kind: "node", version: ">=22", offline: true },
      { kind: "python", version: ">=3.11", offline: true },
      { kind: "python", version: ">=3.11", offline: true },
      { kind: "python", version: ">=3.11", offline: true },
    ]);

    const tasks = repairScenario().benchmark.tasks();
    expect(tasks.map((task) => task.id)).toEqual(
      fixtures.map((fixture) => fixture.id),
    );
  });

  it("defines corpus metrics and summarizes raw samples by language", () => {
    expect(
      repairScenario().benchmark.manifest.metrics.map((metric) => metric.id),
    ).toEqual([
      "hidden_test_pass_ratio",
      "sample_count",
      "typescript_hidden_test_pass_ratio",
      "typescript_sample_count",
      "python_hidden_test_pass_ratio",
      "python_sample_count",
      "duration_ms",
    ]);

    expect(
      summarizeRepairCorpus([
        repairCorpusSample("typescript-clamp-bounds", { passed: 3, total: 3 }),
        repairCorpusSample("typescript-async-cache", { passed: 2, total: 3 }),
        repairCorpusSample("python-parse-duration", { passed: 1, total: 3 }),
      ]),
    ).toEqual([
      { metricId: "hidden_test_pass_ratio", value: 0.6666666666666666 },
      { metricId: "sample_count", value: 3 },
      {
        metricId: "typescript_hidden_test_pass_ratio",
        value: 0.8333333333333334,
      },
      { metricId: "typescript_sample_count", value: 2 },
      { metricId: "python_hidden_test_pass_ratio", value: 0.3333333333333333 },
      { metricId: "python_sample_count", value: 1 },
    ]);
  });

  it("records fixture and grader hashes on corpus samples", () => {
    const fixture = repairFixture("python-api-boundary");

    expect(repairCorpusSample(fixture.id, { passed: 3, total: 3 })).toEqual({
      fixtureId: fixture.id,
      fixtureContentHash: fixture.contentHash,
      graderHash: fixture.graderHash,
      grade: { passed: 3, total: 3 },
    });
  });

  it("rejects unknown fixtures and keeps missing grades explicit in summaries", () => {
    expect(() => repairFixture("missing-fixture" as RepairFixtureId)).toThrow(
      "Unknown repository-repair fixture: missing-fixture",
    );

    expect(
      summarizeRepairCorpus([repairCorpusSample("python-api-boundary", null)]),
    ).toEqual([
      { metricId: "hidden_test_pass_ratio", value: null },
      { metricId: "sample_count", value: 1 },
      { metricId: "typescript_hidden_test_pass_ratio", value: null },
      { metricId: "typescript_sample_count", value: 0 },
      { metricId: "python_hidden_test_pass_ratio", value: null },
      { metricId: "python_sample_count", value: 1 },
    ]);
  });
});
