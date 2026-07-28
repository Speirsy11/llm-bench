import { describe, expect, it } from "vitest";

import {
  cleanProcessEnvironment,
  isolatedProcessEnvironment,
} from "./environment";

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

describe("isolatedProcessEnvironment", () => {
  it("keeps process-launch essentials without exposing homes or ambient credentials", () => {
    expect(
      isolatedProcessEnvironment(
        {
          HOME: "/home/runner",
          CODEX_HOME: "/home/runner/.codex",
          PATH: "/bin",
          TMPDIR: "/tmp/runner",
          LANG: "en_GB.UTF-8",
          OPENAI_API_KEY: "must-not-leak",
        },
        { MCP_TOKEN: "explicit-grant", OMITTED: undefined },
      ),
    ).toEqual({
      PATH: "/bin",
      TMPDIR: "/tmp/runner",
      LANG: "en_GB.UTF-8",
      MCP_TOKEN: "explicit-grant",
    });
  });
});
