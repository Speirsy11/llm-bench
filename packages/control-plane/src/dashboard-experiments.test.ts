import { describe, expect, it } from "vitest";

import { createDashboardExperimentService } from "./dashboard-experiments";

type DashboardDatabase = Parameters<typeof createDashboardExperimentService>[0];

describe("createDashboardExperimentService", () => {
  it("rejects experiment detail rows whose job target is missing", async () => {
    const db = {
      query: {
        experiments: {
          findFirst: () =>
            Promise.resolve({
              id: "experiment-corrupt",
              ownerId: "owner-1",
              name: "Corrupt experiment",
            }),
        },
        targets: { findMany: () => Promise.resolve([]) },
        jobs: {
          findMany: () =>
            Promise.resolve([
              {
                id: "job-missing-target",
                targetId: "target-missing",
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
        "experiment-corrupt",
      ),
    ).rejects.toThrow(
      "Experiment target not found for job job-missing-target.",
    );
  });
});
