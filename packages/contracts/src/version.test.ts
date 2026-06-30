import { describe, expect, it } from "vitest";

import {
  isSupportedProtocolVersion,
  parseProtocolVersion,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_MAJOR,
} from "./version";

describe("parseProtocolVersion", () => {
  it("splits a semantic version into numeric components", () => {
    expect(parseProtocolVersion("1.4.2")).toEqual({
      major: 1,
      minor: 4,
      patch: 2,
    });
  });

  it("throws on a malformed version string", () => {
    expect(() => parseProtocolVersion("v1")).toThrow(
      /Invalid protocol version "v1"/,
    );
  });
});

describe("isSupportedProtocolVersion", () => {
  it("accepts a version sharing the supported major", () => {
    expect(isSupportedProtocolVersion("1.9.0")).toBe(true);
  });

  it("rejects an unknown future major version", () => {
    expect(isSupportedProtocolVersion("2.0.0")).toBe(false);
  });

  it("rejects a malformed version", () => {
    expect(isSupportedProtocolVersion("not-a-version")).toBe(false);
  });
});

describe("constants", () => {
  it("ships a current protocol version on the supported major", () => {
    expect(parseProtocolVersion(PROTOCOL_VERSION).major).toBe(
      SUPPORTED_PROTOCOL_MAJOR,
    );
  });
});
