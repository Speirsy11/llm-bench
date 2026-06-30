import { describe, expect, it } from "vitest";

import { toAuthContext } from "./auth-context";

describe("toAuthContext", () => {
  it("maps a GitHub session into an administrator auth context", () => {
    expect(
      toAuthContext({ user: { id: "user-1", githubLogin: "OctoAdmin" } }, [
        "octoadmin",
      ]),
    ).toEqual({
      userId: "user-1",
      githubLogin: "OctoAdmin",
      isAdmin: true,
    });
  });
});
