import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createDashboardExperimentService } from "./dashboard-experiments";

type DashboardDatabase = Parameters<typeof createDashboardExperimentService>[0];

describe("createDashboardExperimentService", () => {
  it("uses a generic launch rejection when preview has no blockers", async () => {
    const service = createDashboardExperimentService(
      {} as unknown as DashboardDatabase,
    );
    const input = {
      name: "No blocker launch",
      runnerId: randomUUID(),
      credentialProfileId: randomUUID(),
      modelRoutes: [],
      harnesses: [],
      toolsets: [],
    };
    service.previewExperiment = (_actor, parsedInput) =>
      Promise.resolve({
        input: parsedInput,
        projectedJobCount: 0,
        spend: { kind: "unknown" },
        canLaunch: false,
        blockers: [],
        order: [],
      });

    await expect(
      service.launchExperiment(
        { userId: "owner-1", githubLogin: "owner", isAdmin: false },
        { ...input, spendConfirmed: true },
      ),
    ).rejects.toThrow("Experiment cannot be launched.");
  });

  it("rejects experiment detail rows whose job target is missing", async () => {
    const experimentId = randomUUID();
    const jobId = randomUUID();
    const missingTargetId = randomUUID();
    const db = {
      query: {
        experiments: {
          findFirst: () =>
            Promise.resolve({
              id: experimentId,
              ownerId: "owner-1",
              name: "Corrupt experiment",
            }),
        },
        targets: { findMany: () => Promise.resolve([]) },
        jobs: {
          findMany: () =>
            Promise.resolve([
              {
                id: jobId,
                targetId: missingTargetId,
                status: "queued",
                retryOfJobId: null,
                cancellationRequested: false,
              },
            ]),
        },
        attempts: { findMany: () => Promise.resolve([]) },
        results: { findMany: () => Promise.resolve([]) },
        metrics: { findMany: () => Promise.resolve([]) },
      },
    } as unknown as DashboardDatabase;
    const service = createDashboardExperimentService(db);

    await expect(
      service.getExperiment(
        { userId: "owner-1", githubLogin: "owner", isAdmin: false },
        experimentId,
      ),
    ).rejects.toThrow(`Experiment target not found for job ${jobId}.`);
  });
});
