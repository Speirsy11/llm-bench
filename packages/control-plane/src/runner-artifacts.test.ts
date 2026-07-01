import { describe, expect, it } from "vitest";

import { validateRunnerArtifactUpload } from "./runner-artifacts";

describe("validateRunnerArtifactUpload", () => {
  it("accepts only the content-addressed path for one attempt", () => {
    const contentHash = "a".repeat(64);
    expect(
      validateRunnerArtifactUpload({
        attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
        pathname: `attempts/d0da824f-6f6a-4a01-af27-f7448d22bb39/${contentHash}.patch`,
        contentHash,
        byteLength: 42,
      }),
    ).toEqual({ maximumSizeInBytes: 42 });

    for (const invalid of [
      { pathname: `attempts/other/${contentHash}.patch` },
      {
        pathname: `attempts/d0da824f-6f6a-4a01-af27-f7448d22bb39/../${contentHash}.patch`,
      },
      { contentHash: "not-a-hash" },
      { byteLength: -1 },
      { byteLength: 10 * 1024 * 1024 + 1 },
    ]) {
      expect(() =>
        validateRunnerArtifactUpload({
          attemptId: "d0da824f-6f6a-4a01-af27-f7448d22bb39",
          pathname: `attempts/d0da824f-6f6a-4a01-af27-f7448d22bb39/${contentHash}.patch`,
          contentHash,
          byteLength: 42,
          ...invalid,
        }),
      ).toThrow("Artifact upload is invalid.");
    }
  });
});
