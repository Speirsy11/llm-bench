import { describe, expect, it } from "vitest";

import { resolveRouteAccess } from "./route-policy";

describe("resolveRouteAccess", () => {
  it("keeps public routes open and requires a session for the dashboard", () => {
    expect(resolveRouteAccess("/", null)).toEqual({ kind: "allow" });
    expect(resolveRouteAccess("/dashboard", null)).toEqual({
      kind: "redirect",
      location: "/api/auth/signin?callbackUrl=%2Fdashboard",
    });
    expect(
      resolveRouteAccess("/dashboard", {
        userId: "user-1",
        githubLogin: "owner",
        isAdmin: false,
      }),
    ).toEqual({ kind: "allow" });
  });
});
