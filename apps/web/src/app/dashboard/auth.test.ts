import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDashboardActor, getDashboardActorSession } from "./auth";

const { auth, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect }));

describe("dashboard auth", () => {
  beforeEach(() => {
    auth.mockReset();
    redirect.mockReset();
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
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
