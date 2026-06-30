import { describe, expect, it } from "vitest";

import { CapabilitySchema, evaluateCompatibility } from "./capability";

describe("CapabilitySchema", () => {
  it("accepts an advertised capability from the fixed set", () => {
    expect(CapabilitySchema.safeParse("workspaces").success).toBe(true);
  });

  it("rejects a capability outside the fixed set", () => {
    expect(CapabilitySchema.safeParse("telepathy").success).toBe(false);
  });
});

describe("evaluateCompatibility", () => {
  it("is compatible when every required capability is advertised", () => {
    expect(
      evaluateCompatibility(
        ["response_generation", "structured_output"],
        ["response_generation", "structured_output", "streaming"],
      ),
    ).toEqual({ compatible: true });
  });

  it("reports the missing capabilities as a typed failure", () => {
    expect(
      evaluateCompatibility(
        ["workspaces", "shell", "files"],
        ["response_generation"],
      ),
    ).toEqual({
      compatible: false,
      missing: ["workspaces", "shell", "files"],
    });
  });
});
