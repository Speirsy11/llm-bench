import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import { redactSecrets, REDACTION_MARKER, Secret } from "./redaction";

describe("redaction", () => {
  it("redacts secret substrings from arbitrary text", () => {
    const text = "authorization: Bearer sk-secret and again sk-secret";
    expect(redactSecrets(text, ["sk-secret"])).toBe(
      `authorization: Bearer ${REDACTION_MARKER} and again ${REDACTION_MARKER}`,
    );
  });

  it("ignores empty secrets so it cannot blank the input", () => {
    expect(redactSecrets("hello", [""])).toBe("hello");
  });

  it("redacts every provided secret", () => {
    expect(redactSecrets("a-b", ["a", "b"])).toBe(
      `${REDACTION_MARKER}-${REDACTION_MARKER}`,
    );
  });

  it("hides the plaintext under util.inspect", () => {
    const secret = new Secret("top-secret");
    expect(inspect(secret)).toContain(REDACTION_MARKER);
    expect(inspect({ key: secret })).not.toContain("top-secret");
  });

  it("redacts under toJSON and reveals only explicitly", () => {
    const secret = new Secret("top-secret");
    expect(secret.toJSON()).toBe(REDACTION_MARKER);
    expect(secret.toString()).toBe(REDACTION_MARKER);
    expect(secret.reveal()).toBe("top-secret");
  });
});
