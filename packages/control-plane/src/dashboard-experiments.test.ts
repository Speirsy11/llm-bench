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

  it.each([
    {
      credentialProfileId: undefined,
      credential: null,
      error: "Credential profile is required for LLMBench targets.",
    },
    {
      credentialProfileId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      credential: {
        id: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        ownerId: "owner-1",
        runnerId: "f4a6453c-cdd4-405b-9733-39af0f6d829e",
      },
      error: "Credential profile is not sealed for this runner.",
    },
  ])("rechecks the credential binding inside launch", async (fixture) => {
    const transaction = {
      query: {
        credentialProfiles: {
          findFirst: () => Promise.resolve(fixture.credential),
        },
      },
    };
    const db = {
      transaction: (callback: (value: unknown) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as DashboardDatabase;
    const service = createDashboardExperimentService(db);
    const input = {
      name: "Credential race",
      runnerId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
      credentialProfileId: fixture.credentialProfileId,
      modelRoutes: [],
      harnesses: [
        {
          id: "llmbench",
          version: "1.0.0",
          capabilities: [],
          modelRoutes: [],
        },
      ],
      toolsets: [],
    };
    service.previewExperiment = () =>
      Promise.resolve({
        input,
        projectedJobCount: 0,
        spend: { kind: "unknown" },
        canLaunch: true,
        blockers: [],
        order: [],
      });

    await expect(
      service.launchExperiment(
        { userId: "owner-1", githubLogin: "owner", isAdmin: false },
        { ...input, spendConfirmed: true },
      ),
    ).rejects.toThrow(fixture.error);
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
