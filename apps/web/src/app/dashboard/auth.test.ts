import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDashboardActor, getDashboardActorSession } from "./auth";

const { auth, parseWebEnv, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  parseWebEnv: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/env", () => ({ parseWebEnv }));
vi.mock("next/navigation", () => ({ redirect }));

describe("dashboard auth", () => {
  beforeEach(() => {
    auth.mockReset();
    parseWebEnv.mockReset();
    parseWebEnv.mockReturnValue({ adminGithubLogins: [] });
    redirect.mockReset();
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("derives administrator status from the configured GitHub allowlist", async () => {
    parseWebEnv.mockReturnValue({ adminGithubLogins: ["octoadmin"] });
    auth.mockResolvedValue({
      user: {
        id: "user-admin",
        githubLogin: "OctoAdmin",
        name: "Admin",
      },
    });

    await expect(getDashboardActor()).resolves.toEqual({
      userId: "user-admin",
      githubLogin: "OctoAdmin",
      isAdmin: true,
    });
  });

  it("returns the authenticated dashboard actor", async () => {
    auth.mockResolvedValue({
      user: {
        id: "user-1",
        githubLogin: "octocat",
        name: "Octo Cat",
      },
    });

    await expect(getDashboardActor()).resolves.toEqual({
      userId: "user-1",
      githubLogin: "octocat",
      isAdmin: false,
    });
    await expect(getDashboardActorSession()).resolves.toMatchObject({
      session: { user: { name: "Octo Cat" } },
    });
  });

  it("redirects missing and incomplete sessions to sign in", async () => {
    for (const session of [null, { user: { id: "user-1" } }]) {
      auth.mockResolvedValueOnce(session);
      await expect(getDashboardActorSession()).rejects.toThrow("NEXT_REDIRECT");
    }
    expect(redirect).toHaveBeenCalledTimes(2);
    expect(redirect).toHaveBeenCalledWith(
      "/api/auth/signin?callbackUrl=%2Fdashboard",
    );
  });
});
