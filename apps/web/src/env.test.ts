import { describe, expect, it } from "vitest";

import { parseWebEnv } from "./env";

describe("parseWebEnv", () => {
  it("validates deployment secrets and normalizes the administrator allowlist", () => {
    expect(
      parseWebEnv({
        AUTH_SECRET: "0123456789abcdef0123456789abcdef",
        AUTH_GITHUB_ID: "github-client",
        AUTH_GITHUB_SECRET: "github-secret",
        DATABASE_URL: "postgresql://user:pass@example.neon.tech/llmbench",
        LLMBENCH_ADMIN_GITHUB_LOGINS: " OctoAdmin, speirsy11 ",
      }),
    ).toMatchObject({
      adminGithubLogins: ["octoadmin", "speirsy11"],
      githubClientId: "github-client",
    });

    expect(() =>
      parseWebEnv({
        AUTH_GITHUB_ID: "github-client",
        AUTH_GITHUB_SECRET: "github-secret",
        DATABASE_URL: "postgresql://user:pass@example.neon.tech/llmbench",
        LLMBENCH_ADMIN_GITHUB_LOGINS: "octoadmin",
      }),
    ).toThrow("AUTH_SECRET");
  });

  it("uses non-secret build placeholders only when validation is explicitly skipped", () => {
    expect(parseWebEnv({ SKIP_ENV_VALIDATION: "true" })).toEqual({
      adminGithubLogins: [],
      authSecret: "00000000000000000000000000000000",
      databaseUrl: "postgresql://build:build@localhost:5432/build",
      githubClientId: "build-client",
      githubClientSecret: "build-secret",
    });
  });
});
