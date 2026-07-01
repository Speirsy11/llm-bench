import { describe, expect, it } from "vitest";

import { runnerHome } from "./env";

describe("runnerHome", () => {
  it("uses an explicit runner home when configured", () => {
    expect(runnerHome({ LLMBENCH_RUNNER_HOME: "/tmp/runner-home" })).toBe(
      "/tmp/runner-home",
    );
  });

  it("falls back to a hidden directory under the user home", () => {
    expect(runnerHome({})).toMatch(/\.llm-bench$/);
  });

  it("falls back when the override is blank", () => {
    expect(runnerHome({ LLMBENCH_RUNNER_HOME: "" })).toMatch(/\.llm-bench$/);
  });
});
