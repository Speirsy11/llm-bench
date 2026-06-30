import { describe, expect, it } from "vitest";

import {
  canCurateExperiment,
  canMutateExperiment,
  canReadExperiment,
} from "./access-policy";

describe("canReadExperiment", () => {
  it("lets an anonymous visitor read public data but not private data", () => {
    expect(
      canReadExperiment(null, {
        ownerId: "user-owner",
        visibility: "public",
      }),
    ).toBe(true);
    expect(
      canReadExperiment(null, {
        ownerId: "user-owner",
        visibility: "private",
      }),
    ).toBe(false);
  });
});

describe("canMutateExperiment", () => {
  it("allows the owner and denies a different signed-in user", () => {
    const experiment = {
      ownerId: "user-owner",
      visibility: "private" as const,
    };

    expect(
      canMutateExperiment(
        { userId: "user-owner", githubLogin: "owner", isAdmin: false },
        experiment,
      ),
    ).toBe(true);
    expect(
      canMutateExperiment(
        { userId: "user-other", githubLogin: "other", isAdmin: false },
        experiment,
      ),
    ).toBe(false);
  });
});

describe("canCurateExperiment", () => {
  it("allows only an allowlisted administrator", () => {
    expect(
      canCurateExperiment({
        userId: "user-admin",
        githubLogin: "octoadmin",
        isAdmin: true,
      }),
    ).toBe(true);
    expect(
      canCurateExperiment({
        userId: "user-owner",
        githubLogin: "owner",
        isAdmin: false,
      }),
    ).toBe(false);
  });
});
