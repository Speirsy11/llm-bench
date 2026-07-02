import { describe, expect, it } from "vitest";

import { cleanProcessEnvironment } from "./environment";

describe("cleanProcessEnvironment", () => {
  it("inherits only operational keys and applies defined overrides", () => {
    expect(
      cleanProcessEnvironment(
        {
          HOME: "/home/runner",
          PATH: "/bin",
          API_SECRET: "must-not-leak",
        },
        { FIXTURE_MODE: "safe", OMITTED: undefined },
      ),
    ).toEqual({
      HOME: "/home/runner",
      PATH: "/bin",
      FIXTURE_MODE: "safe",
    });
  });
});
