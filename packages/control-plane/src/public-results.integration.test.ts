import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RunnerExecution } from "@llm-bench/contracts";

import type { AuthContext } from "./access-policy";
import type { PublicExperimentView } from "./public-results";
import {
  repositoryRepairLimits,
  repositoryRepairWorkload,
  responseLimits,
  structuredOutputWorkload,
} from "./benchmark-registry";
import { createControlPlane } from "./control-plane";
import { createDatabase, migrateDatabase, resetTestDatabase } from "./database";
import { createPublicResultService } from "./public-results";
import {
  artifacts,
  attempts,
  experiments,
  jobs,
  metrics,
  results,
  runners,
  targets,
  users,
} from "./schema";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for Postgres integration tests.",
  );
}

const database = createDatabase(connectionString);
const responseEvidenceBytes = Buffer.from(
  JSON.stringify({
    sampleCounts: { warmup: 0, measured: 3 },
    samples: [
      measuredSample(0, 120),
      measuredSample(1, 180),
      measuredSample(2, 150),
    ],
    aggregates: {
      durationMs: aggregate(450, 150),
      providerDurationMs: aggregate(null, null, 0, 3),
      ttftMs: aggregate(null, null, 0, 3),
      inputTokens: aggregate(60, 20),
      outputTokens: aggregate(30, 10),
      costUsd: aggregate(null, null, 0, 3),
      throughputTokensPerSecond: aggregate(200, 200 / 3),
    },
    grades: [
      {
        sampleIndex: 0,
        observations: [
          { metricId: "schema_compliance", value: 1 },
          { metricId: "private_grade", value: null },
        ],
      },
      {
        sampleIndex: 1,
        observations: [{ metricId: "schema_compliance", value: 0 }],
      },
      {
        sampleIndex: 2,
        observations: [{ metricId: "schema_compliance", value: 1 }],
      },
    ],
    invocations: [
      {
        phase: "measured",
        index: 0,
        metadata: { requestId: "private-request-1", output: "private output" },
      },
      { phase: "measured", index: 1, metadata: {} },
      { phase: "measured", index: 2, metadata: {} },
    ],
  }),
);
const responseEvidenceHash = createHash("sha256")
  .update(responseEvidenceBytes)
  .digest("hex");
const artifactReader = {
  read(pathname: string) {
    if (pathname !== "users/private-owner/result.json") {
      throw new Error("Blob unavailable.");
    }
    return Promise.resolve(responseEvidenceBytes);
  },
};
const publicResults = createPublicResultService(database.db, {
  now: () => new Date("2026-07-28T12:00:00.000Z"),
  artifactReader,
});

const owner: AuthContext = {
  userId: "public-owner",
  githubLogin: "private-owner",
  isAdmin: false,
};
const administrator: AuthContext = {
  userId: "public-admin",
  githubLogin: "octoadmin",
  isAdmin: true,
};

beforeAll(async () => {
  await resetTestDatabase(connectionString);
  await migrateDatabase(connectionString);
});

beforeEach(async () => {
  await resetTestDatabase(connectionString);
  await migrateDatabase(connectionString);
  await database.db.insert(users).values([
    {
      id: owner.userId,
      githubId: "public-owner-github",
      githubLogin: owner.githubLogin,
    },
    {
      id: administrator.userId,
      githubId: "public-admin-github",
      githubLogin: administrator.githubLogin,
    },
  ]);
});

afterAll(async () => {
  await database.close();
});

describe("public result curation", () => {
  it("previews sanitized chart data only for the experiment owner", async () => {
    const experimentId = await insertCompletedExperiment();

    const preview = await publicResults.previewAnalysis(owner, experimentId);

    expect(preview).toMatchObject({
      blockers: [],
      view: {
        id: experimentId,
        name: "Curated fixture",
        comparisonGroups: [
          {
            series: [
              {
                status: "completed",
                primaryMetric: { id: "schema_compliance", value: 2 / 3 },
              },
            ],
          },
        ],
        sanitization: { withheldArtifactCount: 1 },
      },
    });
    expect(JSON.stringify(preview)).not.toContain(
      "users/private-owner/result.json",
    );
    expect(JSON.stringify(preview)).not.toContain("private prompt");
    await expect(
      publicResults.previewAnalysis(administrator, experimentId),
    ).resolves.toBeNull();
    await expect(
      publicResults.previewAnalysis(
        owner,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).resolves.toBeNull();

    await expect(
      publicResults.curate(owner, experimentId, "unreviewed"),
    ).rejects.toThrow("Administrator access required.");
  });

  it("stores and serves an administrator-curated allowlisted snapshot", async () => {
    const experimentId = await insertCompletedExperiment();

    await expect(publicResults.get(experimentId)).resolves.toBeNull();
    await expect(publicResults.list()).resolves.toEqual([]);
    await expect(
      publicResults.curate(owner, experimentId, "unreviewed"),
    ).rejects.toThrow("Administrator access required.");

    const preview = await publicResults.previewCuration(
      administrator,
      experimentId,
    );
    expect(preview).toMatchObject({
      canPublish: true,
      blockers: [],
      view: {
        id: experimentId,
        sanitization: { withheldArtifactCount: 1 },
      },
    });

    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    if (!preview.fingerprint) throw new Error("Expected preview fingerprint.");
    await expect(
      publicResults.curate(administrator, experimentId, "0".repeat(64)),
    ).rejects.toThrow(
      "The sanitized publication preview changed. Review and confirm it again.",
    );
    await expect(publicResults.get(experimentId)).resolves.toBeNull();
    const published = await publicResults.curate(
      administrator,
      experimentId,
      preview.fingerprint,
    );
    expect(published.curatedAt).toBe("2026-07-28T12:00:00.000Z");
    const publishedSeries = published.comparisonGroups[0]?.series[0];
    expect(publishedSeries?.sampleCount).toBe(3);
    expect(publishedSeries?.samples).toHaveLength(3);
    expect(publishedSeries?.samples[0]).toMatchObject({
      index: 0,
      observations: [
        { metricId: "schema_compliance", value: 1 },
        { metricId: "duration_ms", value: 120 },
        { metricId: "input_tokens", value: 20 },
        { metricId: "output_tokens", value: 10 },
        {
          metricId: "throughput_tokens_per_second",
          value: 83.33333333333334,
        },
      ],
    });
    expect(JSON.stringify(published)).not.toContain(
      "users/private-owner/result.json",
    );
    expect(JSON.stringify(published)).not.toContain("private prompt");
    expect(JSON.stringify(published)).not.toContain("private-request-1");
    expect(JSON.stringify(published)).not.toContain("private output");

    await expect(publicResults.list()).resolves.toEqual([
      {
        id: experimentId,
        name: "Curated fixture",
        benchmarkIds: ["structured-output"],
        resultCount: 1,
        curatedAt: "2026-07-28T12:00:00.000Z",
      },
    ]);
    await expect(publicResults.get(experimentId)).resolves.toEqual(published);

    const controlPlane = createControlPlane({ connectionString });
    try {
      await expect(
        controlPlane.experiments.get(null, experimentId),
      ).resolves.toBeNull();
      const privateExperiment = await controlPlane.experiments.get(
        owner,
        experimentId,
      );
      expect(privateExperiment?.id).toBe(experimentId);
      expect(privateExperiment?.configurationSnapshot).toBeTruthy();
    } finally {
      await controlPlane.close();
    }

    const [row] = await database.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId));
    expect(row).toMatchObject({
      visibility: "public",
      curatedBy: administrator.userId,
      curatedAt: new Date("2026-07-28T12:00:00.000Z"),
      publicSnapshot: published,
    });
    await expect(
      publicResults.previewAnalysis(owner, experimentId),
    ).resolves.toEqual({ blockers: [], view: published });
  });

  it("binds approval to the snapshot while allowing publication time to advance", async () => {
    const experimentId = await insertCompletedExperiment();
    let currentTime = new Date("2026-07-28T12:00:00.000Z");
    const advancingService = createPublicResultService(database.db, {
      now: () => currentTime,
      artifactReader,
    });
    const preview = await advancingService.previewCuration(
      administrator,
      experimentId,
    );
    if (!preview.fingerprint) throw new Error("Expected preview fingerprint.");

    currentTime = new Date("2026-07-28T12:05:00.000Z");
    const published = await advancingService.curate(
      administrator,
      experimentId,
      preview.fingerprint,
    );

    expect(preview.view?.curatedAt).toBe("2026-07-28T12:00:00.000Z");
    expect(published.curatedAt).toBe("2026-07-28T12:05:00.000Z");
  });

  it("rejects approval when a sanitized outward field changes after preview", async () => {
    const experimentId = await insertCompletedExperiment();
    const preview = await publicResults.previewCuration(
      administrator,
      experimentId,
    );
    if (!preview.fingerprint) throw new Error("Expected preview fingerprint.");
    await database.db
      .update(experiments)
      .set({ name: "Changed after review" })
      .where(eq(experiments.id, experimentId));

    await expect(
      publicResults.curate(administrator, experimentId, preview.fingerprint),
    ).rejects.toThrow(
      "The sanitized publication preview changed. Review and confirm it again.",
    );
    await expect(publicResults.get(experimentId)).resolves.toBeNull();
  });

  it("blocks active or empty experiments from publication", async () => {
    const activeId = await insertActiveExperiment();
    const emptyId = await insertEmptyExperiment();

    await expect(
      publicResults.previewCuration(administrator, activeId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: ["All jobs must be terminal before curation."],
      view: null,
    });
    await expect(
      publicResults.previewCuration(administrator, emptyId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: ["At least one job is required for curation."],
      view: null,
    });
    await expect(
      publicResults.curate(administrator, activeId, "unreviewed"),
    ).rejects.toThrow("All jobs must be terminal before curation.");
    await expect(
      createPublicResultService(database.db).previewCuration(
        administrator,
        emptyId,
      ),
    ).resolves.toMatchObject({ canPublish: false });
  });

  it("withdraws a curated snapshot without deleting the private run", async () => {
    const experimentId = await insertCompletedExperiment();
    const published = await previewAndCurate(experimentId);

    await expect(publicResults.withdraw(owner, experimentId)).rejects.toThrow(
      "Administrator access required.",
    );
    await expect(
      publicResults.withdraw(
        administrator,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).rejects.toThrow("Experiment is unavailable.");
    await publicResults.withdraw(administrator, experimentId);

    await expect(publicResults.get(experimentId)).resolves.toBeNull();
    const [row] = await database.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId));
    expect(row).toMatchObject({
      id: experimentId,
      visibility: "private",
      curatedAt: new Date(published.curatedAt),
      curatedBy: administrator.userId,
      publicSnapshot: published,
    });
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: ["Experiment was already published and cannot be republished."],
      view: null,
    });
    await expect(
      publicResults.curate(administrator, experimentId, "unreviewed"),
    ).rejects.toThrow(
      "Experiment was already published and cannot be republished.",
    );
  });

  it("publishes an experiment identity only once", async () => {
    const experimentId = await insertCompletedExperiment();
    const preview = await publicResults.previewCuration(
      administrator,
      experimentId,
    );
    if (!preview.fingerprint) throw new Error("Expected preview fingerprint.");
    const attempts = await Promise.allSettled([
      publicResults.curate(administrator, experimentId, preview.fingerprint),
      publicResults.curate(administrator, experimentId, preview.fingerprint),
    ]);
    const published = attempts.find(
      (attempt): attempt is PromiseFulfilledResult<PublicExperimentView> =>
        attempt.status === "fulfilled",
    )?.value;
    expect(published).toBeDefined();
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expect(publicResults.get(experimentId)).resolves.toEqual(published);
  });

  it("retains a public snapshot by restricting deletion of its curator", async () => {
    const experimentId = await insertCompletedExperiment();
    const published = await previewAndCurate(experimentId);

    await expect(
      database.db.delete(users).where(eq(users.id, administrator.userId)),
    ).rejects.toThrow();
    await expect(publicResults.get(experimentId)).resolves.toEqual(published);
  });

  it("shows terminal jobs without a result as explicit partial data", async () => {
    const experimentId = await insertCompletedExperiment();
    await insertFailedJob(experimentId);

    const published = await previewAndCurate(experimentId);
    expect(published.comparisonGroups).toHaveLength(1);
    const missingSeries = published.comparisonGroups[0]?.series.find(
      ({ id }) => id === "00000000-0000-4000-8000-000000000015",
    );
    expect(missingSeries).toMatchObject({
      id: "00000000-0000-4000-8000-000000000015",
      status: "failed",
      sampleCount: 0,
      rank: null,
      primaryMetric: {
        id: "schema_compliance",
        missing: true,
        value: null,
      },
    });
  });

  it("publishes agentic results as one observed run regardless of configuration", async () => {
    const experimentId = await insertCompletedExperiment();
    const [result] = await database.db.select().from(results).limit(1);
    if (!result) throw new Error("Expected durable result.");
    await database.db.update(jobs).set({
      benchmarkId: "repository-repair",
      benchmarkVersion: "1.0.0",
      execution: agenticExecution(),
    });
    await database.db.update(results).set({
      benchmarkId: "repository-repair",
      benchmarkVersion: "1.0.0",
      primaryMetricId: "hidden_test_pass_ratio",
    });
    await database.db.delete(metrics);
    await database.db.insert(metrics).values({
      resultId: result.id,
      metricId: "hidden_test_pass_ratio",
      kind: "ratio",
      unit: "ratio",
      direction: "higher_is_better",
      value: 1,
    });
    await database.db.delete(artifacts);
    await database.db.insert(artifacts).values({
      resultId: result.id,
      kind: "diff",
      blobPath: `attempts/agentic/${"c".repeat(64)}.patch`,
      contentHash: "c".repeat(64),
      byteLength: 128,
    });

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: true,
      view: {
        comparisonGroups: [
          {
            comparison: { rankingEligible: false },
            series: [
              {
                rank: null,
                sampleCount: 1,
                samples: [],
                artifactSummary: {
                  kinds: ["patch_diff"],
                  totalBytes: 128,
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("reports missing durable inputs instead of publishing corrupt rows", async () => {
    const experimentId = await insertCompletedExperiment();
    const [job] = await database.db
      .select()
      .from(jobs)
      .where(eq(jobs.experimentId, experimentId));
    if (!job?.runnerId) throw new Error("Expected durable job.");
    const validExecution = job.execution;

    await database.db
      .update(jobs)
      .set({ benchmarkId: null })
      .where(eq(jobs.id, job.id));
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [`Job ${job.id} is missing benchmark metadata.`],
    });

    await database.db
      .update(jobs)
      .set({
        benchmarkId: "structured-output",
        execution: {} as RunnerExecution,
      })
      .where(eq(jobs.id, job.id));
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [`Job ${job.id} is missing a valid execution snapshot.`],
    });

    await database.db
      .update(jobs)
      .set({ execution: validExecution, runnerId: null })
      .where(eq(jobs.id, job.id));
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [`Job ${job.id} is missing a valid runner environment.`],
    });
  });

  it("blocks response evidence that is missing, unreadable, or unverifiable", async () => {
    const missingId = await insertCompletedExperiment();
    await expect(
      createPublicResultService(database.db).previewCuration(
        administrator,
        missingId,
      ),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining(
          "response evidence cannot be read for curation",
        ),
      ],
    });

    await database.db.delete(artifacts);
    await expect(
      publicResults.previewCuration(administrator, missingId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining(
          "requires exactly one response_evidence artifact",
        ),
      ],
    });

    await resetTestDatabase(connectionString);
    await migrateDatabase(connectionString);
    await database.db.insert(users).values([
      {
        id: owner.userId,
        githubId: "public-owner-github",
        githubLogin: owner.githubLogin,
      },
      {
        id: administrator.userId,
        githubId: "public-admin-github",
        githubLogin: administrator.githubLogin,
      },
    ]);
    const corruptId = await insertCompletedExperiment();
    await database.db.update(artifacts).set({ contentHash: "f".repeat(64) });
    await expect(
      publicResults.previewCuration(administrator, corruptId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining("malformed or unverifiable response evidence"),
      ],
    });

    const malformedBytes = Buffer.from('{"sampleCounts":{"measured":3}}');
    await database.db.update(artifacts).set({
      contentHash: createHash("sha256").update(malformedBytes).digest("hex"),
      byteLength: malformedBytes.byteLength,
    });
    const malformedReader = createPublicResultService(database.db, {
      artifactReader: {
        read: () => Promise.resolve(malformedBytes),
      },
    });
    await expect(
      malformedReader.previewCuration(administrator, corruptId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining("malformed or unverifiable response evidence"),
      ],
    });

    await database.db.update(artifacts).set({
      contentHash: responseEvidenceHash,
      byteLength: responseEvidenceBytes.byteLength + 1,
    });
    await expect(
      publicResults.previewCuration(administrator, corruptId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining("malformed or unverifiable response evidence"),
      ],
    });

    const inconsistentEvidence = JSON.parse(
      responseEvidenceBytes.toString("utf8"),
    ) as {
      sampleCounts: { measured: number; warmup: number };
    };
    inconsistentEvidence.sampleCounts.measured += 1;
    const inconsistentBytes = Buffer.from(JSON.stringify(inconsistentEvidence));
    await database.db.update(artifacts).set({
      contentHash: createHash("sha256").update(inconsistentBytes).digest("hex"),
      byteLength: inconsistentBytes.byteLength,
    });
    const inconsistentReader = createPublicResultService(database.db, {
      artifactReader: {
        read: () => Promise.resolve(inconsistentBytes),
      },
    });
    await expect(
      inconsistentReader.previewCuration(administrator, corruptId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringContaining("malformed or unverifiable response evidence"),
      ],
    });
  });

  it("rejects invalid durable metric metadata before publication", async () => {
    const experimentId = await insertCompletedExperiment();
    await database.client.unsafe(
      "update metrics set kind = 'unknown_metric_kind'",
    );

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: [
        expect.stringMatching(/^Result .+ has invalid metric metadata\.$/u),
      ],
    });
    await expect(
      publicResults.curate(administrator, experimentId, "unreviewed"),
    ).rejects.toThrow("has invalid metric metadata");
  });

  it("rejects an unapproved metric even when its primitive metadata is valid", async () => {
    const experimentId = await insertCompletedExperiment();
    await database.client.unsafe(
      "update metrics set metric_id = 'invented_public_score', kind = 'count', unit = 'points', direction = 'higher_is_better' where metric_id = 'schema_compliance'",
    );

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: [
        expect.stringMatching(/^Result .+ has invalid metric metadata\.$/u),
      ],
    });
  });

  it("rejects unapproved benchmark and primary metric identities", async () => {
    const experimentId = await insertCompletedExperiment();
    await database.db
      .update(jobs)
      .set({ benchmarkVersion: "9.9.9" })
      .where(eq(jobs.experimentId, experimentId));
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringMatching(/^Job .+ has unapproved benchmark metadata\.$/u),
      ],
    });

    await database.db
      .update(jobs)
      .set({ benchmarkVersion: "1.0.0" })
      .where(eq(jobs.experimentId, experimentId));
    await database.db.update(results).set({ primaryMetricId: "duration_ms" });
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringMatching(
          /^Result .+ has invalid primary metric metadata\.$/u,
        ),
      ],
    });
  });

  it("rejects workload or limit drift from the registered benchmark", async () => {
    const experimentId = await insertCompletedExperiment();
    const approvedExecution = responseExecution();
    const workloadDrift = {
      ...approvedExecution,
      workload: {
        ...approvedExecution.workload,
        case: {
          ...approvedExecution.workload.case,
          prompt: "a persisted but unapproved prompt",
        },
      },
    };
    await database.db
      .update(jobs)
      .set({
        execution: workloadDrift,
        workload: workloadDrift.workload,
        limits: workloadDrift.limits,
      })
      .where(eq(jobs.experimentId, experimentId));

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringMatching(
          /^Job .+ has unapproved execution conditions\.$/u,
        ),
      ],
    });

    const limitDrift = {
      ...approvedExecution,
      limits: {
        ...approvedExecution.limits,
        maxTokens: approvedExecution.limits.maxTokens - 1,
      },
    };
    await database.db
      .update(jobs)
      .set({
        execution: limitDrift,
        workload: limitDrift.workload,
        limits: limitDrift.limits,
      })
      .where(eq(jobs.experimentId, experimentId));

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      blockers: [
        expect.stringMatching(
          /^Job .+ has unapproved execution conditions\.$/u,
        ),
      ],
    });
  });

  it("rejects durable aggregates that contradict measured response evidence", async () => {
    const experimentId = await insertCompletedExperiment();
    await database.db
      .update(metrics)
      .set({ value: 1 })
      .where(eq(metrics.metricId, "schema_compliance"));

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: [
        expect.stringMatching(
          /^Result .+ aggregates do not match response evidence\.$/u,
        ),
      ],
    });

    await database.db
      .update(metrics)
      .set({ value: null })
      .where(eq(metrics.metricId, "schema_compliance"));
    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toMatchObject({
      canPublish: false,
      blockers: [
        expect.stringMatching(
          /^Result .+ aggregates do not match response evidence\.$/u,
        ),
      ],
    });
  });

  it("rejects terminal experiments with no persisted result", async () => {
    const experimentId = await insertCompletedExperiment();
    const [job] = await database.db
      .select()
      .from(jobs)
      .where(eq(jobs.experimentId, experimentId));
    if (!job) throw new Error("Expected durable job.");
    await database.db.delete(attempts).where(eq(attempts.jobId, job.id));

    await expect(
      publicResults.previewCuration(administrator, experimentId),
    ).resolves.toEqual({
      canPublish: false,
      blockers: ["At least one persisted result is required for curation."],
      view: null,
      fingerprint: null,
    });
  });

  it("ignores malformed public snapshots", async () => {
    const experimentId = await insertEmptyExperiment("Malformed snapshot");
    await database.db
      .update(experiments)
      .set({
        visibility: "public",
        curatedAt: new Date("2026-07-28T12:00:00.000Z"),
        curatedBy: administrator.userId,
        publicSnapshot: {
          schemaVersion: 1,
        } as unknown as PublicExperimentView,
      })
      .where(eq(experiments.id, experimentId));

    await expect(publicResults.get(experimentId)).resolves.toBeNull();
    await expect(publicResults.list()).resolves.toEqual([]);
    await expect(
      publicResults.previewCuration(
        administrator,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).resolves.toEqual({
      canPublish: false,
      blockers: ["Experiment is unavailable."],
      view: null,
      fingerprint: null,
    });
  });
});

async function previewAndCurate(experimentId: string) {
  const preview = await publicResults.previewCuration(
    administrator,
    experimentId,
  );
  if (!preview.fingerprint) throw new Error("Expected preview fingerprint.");
  return publicResults.curate(administrator, experimentId, preview.fingerprint);
}

async function insertCompletedExperiment(): Promise<string> {
  const experimentId = await insertEmptyExperiment();
  const runnerId = "00000000-0000-4000-8000-000000000010";
  const targetId = "00000000-0000-4000-8000-000000000011";
  const jobId = "00000000-0000-4000-8000-000000000012";
  const attemptId = "00000000-0000-4000-8000-000000000013";
  const resultId = "00000000-0000-4000-8000-000000000014";
  const execution = responseExecution();
  await database.db.insert(runners).values({
    id: runnerId,
    ownerId: owner.userId,
    name: "private-owner laptop",
    publicKey: "private-public-key",
    capabilities: ["response_generation"],
    environment: {
      os: "darwin",
      architecture: "arm64",
      cpuClass: "Apple M3",
      memoryMb: 16_384,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions: { llmbench: "1.0.0" },
      sandboxMode: "workspace-write",
      contentHashes: { runner: "c".repeat(64) },
    },
  });
  await database.db.insert(targets).values({
    id: targetId,
    experimentId,
    position: 0,
    modelRoute: execution.target.modelRoute,
    harness: execution.target.harness,
    toolset: execution.target.toolset,
  });
  await database.db.insert(jobs).values({
    id: jobId,
    experimentId,
    targetId,
    runnerId,
    status: "completed",
    benchmarkId: "structured-output",
    benchmarkVersion: "1.0.0",
    execution,
    workload: execution.workload,
    limits: execution.limits,
    requiredCapabilities: ["response_generation"],
  });
  await database.db.insert(attempts).values({
    id: attemptId,
    jobId,
    number: 1,
    status: "completed",
    runnerId,
    terminal: {
      attemptId,
      status: "completed",
      observations: [{ metricId: "schema_compliance", value: 1 }],
      artifacts: [],
      error: null,
    },
  });
  await database.db.insert(results).values({
    id: resultId,
    attemptId,
    benchmarkId: "structured-output",
    benchmarkVersion: "1.0.0",
    primaryMetricId: "schema_compliance",
    summary: { status: "completed" },
  });
  await database.db.insert(metrics).values([
    {
      resultId,
      metricId: "schema_compliance",
      kind: "ratio",
      unit: "ratio",
      direction: "higher_is_better",
      value: 2 / 3,
    },
    {
      resultId,
      metricId: "duration_ms",
      kind: "duration",
      unit: "ms",
      direction: "lower_is_better",
      value: 150,
    },
    {
      resultId,
      metricId: "cost_usd",
      kind: "currency",
      unit: "USD",
      direction: "lower_is_better",
      value: null,
    },
  ]);
  await database.db.insert(artifacts).values({
    resultId,
    kind: "response_evidence",
    blobPath: "users/private-owner/result.json",
    contentHash: responseEvidenceHash,
    byteLength: responseEvidenceBytes.byteLength,
  });
  return experimentId;
}

function measuredSample(index: number, durationMs: number) {
  return {
    phase: "measured",
    index,
    durationMs,
    providerDurationMs: null,
    ttftMs: null,
    inputTokens: 20,
    outputTokens: 10,
    costUsd: null,
    throughputTokensPerSecond: 10 / (durationMs / 1_000),
    missingReasons: {
      providerDurationMs: "not_reported",
      ttftMs: "not_reported",
      costUsd: "not_reported",
    },
  };
}

function aggregate(
  sum: number | null,
  mean: number | null,
  availableSampleCount = 3,
  missingSampleCount = 0,
) {
  return {
    availableSampleCount,
    missingSampleCount,
    sum,
    mean,
    p50: mean,
    p95: mean,
    variance: mean === null ? null : 0,
    missingReasons: mean === null ? ["not_reported"] : [],
  };
}

async function insertActiveExperiment(): Promise<string> {
  const experimentId = await insertEmptyExperiment("Active fixture");
  const runnerId = "00000000-0000-4000-8000-000000000020";
  const targetId = "00000000-0000-4000-8000-000000000021";
  const execution = responseExecution();
  await database.db.insert(runners).values({
    id: runnerId,
    ownerId: owner.userId,
    name: "active runner",
    publicKey: "active-public-key",
    capabilities: ["response_generation"],
    environment: {
      os: "linux",
      architecture: "x64",
      cpuClass: "x64",
      memoryMb: 8192,
      runtimeVersions: { node: "22.21.0" },
      harnessVersions: { llmbench: "1.0.0" },
      sandboxMode: "workspace-write",
      contentHashes: {},
    },
  });
  await database.db.insert(targets).values({
    id: targetId,
    experimentId,
    position: 0,
    modelRoute: execution.target.modelRoute,
    harness: execution.target.harness,
    toolset: execution.target.toolset,
  });
  await database.db.insert(jobs).values({
    experimentId,
    targetId,
    runnerId,
    status: "running",
    benchmarkId: "structured-output",
    benchmarkVersion: "1.0.0",
    execution,
    workload: execution.workload,
    limits: execution.limits,
    requiredCapabilities: ["response_generation"],
  });
  return experimentId;
}

async function insertFailedJob(experimentId: string): Promise<void> {
  const [target] = await database.db
    .select()
    .from(targets)
    .where(eq(targets.experimentId, experimentId));
  const [existingJob] = await database.db
    .select()
    .from(jobs)
    .where(eq(jobs.experimentId, experimentId));
  if (!target || !existingJob?.runnerId || !existingJob.execution) {
    throw new Error("Expected completed experiment fixture.");
  }
  await database.db.insert(jobs).values({
    id: "00000000-0000-4000-8000-000000000015",
    experimentId,
    targetId: target.id,
    runnerId: existingJob.runnerId,
    status: "failed",
    benchmarkId: "structured-output",
    benchmarkVersion: "1.0.0",
    execution: existingJob.execution,
    workload: existingJob.workload,
    limits: existingJob.limits,
    requiredCapabilities: ["response_generation"],
  });
}

async function insertEmptyExperiment(
  name = "Curated fixture",
): Promise<string> {
  const [experiment] = await database.db
    .insert(experiments)
    .values({
      ownerId: owner.userId,
      name,
      visibility: "private",
    })
    .returning();
  if (!experiment) throw new Error("Expected experiment.");
  return experiment.id;
}

function responseExecution() {
  return {
    workload: structuredClone(structuredOutputWorkload),
    target: {
      modelRoute: {
        id: "openrouter-gpt-alpha",
        provider: "openrouter",
        model: "openai/gpt-alpha",
      },
      harness: {
        id: "llmbench",
        version: "1.0.0",
        capabilities: ["response_generation" as const],
        modelRoutes: [],
      },
      toolset: {
        id: "response",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [],
      },
    },
    limits: structuredClone(responseLimits),
    credential: null,
  };
}

function agenticExecution() {
  return {
    ...responseExecution(),
    workload: structuredClone(repositoryRepairWorkload),
    target: {
      ...responseExecution().target,
      harness: {
        ...responseExecution().target.harness,
        capabilities: [
          "response_generation" as const,
          "workspaces" as const,
          "files" as const,
        ],
      },
      toolset: {
        id: "builtin",
        version: "1.0.0",
        tools: ["read_file", "write_file"],
        mcpProfiles: [],
      },
    },
    limits: structuredClone(repositoryRepairLimits),
  };
}
