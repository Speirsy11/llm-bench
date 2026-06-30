import { describe, expect, it } from "vitest";

import { decodeWire, encodeWire, WireEnvelopeSchema } from "./wire";

describe("wire envelopes", () => {
  it("round-trips a payload through JSON without provider-specific fields", () => {
    const envelope = encodeWire("benchmark_manifest", {
      id: "structured-output",
      version: "1.0.0",
    });

    const decoded = decodeWire(JSON.parse(JSON.stringify(envelope)));

    expect(decoded).toEqual({
      protocolVersion: "1.0.0",
      kind: "benchmark_manifest",
      payload: { id: "structured-output", version: "1.0.0" },
    });
  });

  it("rejects an envelope on an unknown future major version", () => {
    expect(
      WireEnvelopeSchema.safeParse({
        protocolVersion: "2.0.0",
        kind: "benchmark_manifest",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("rejects an envelope with a malformed protocol version", () => {
    expect(
      WireEnvelopeSchema.safeParse({
        protocolVersion: "latest",
        kind: "benchmark_manifest",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("rejects an envelope missing a required field", () => {
    expect(
      WireEnvelopeSchema.safeParse({
        protocolVersion: "1.0.0",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("rejects unknown envelope fields", () => {
    expect(
      WireEnvelopeSchema.safeParse({
        protocolVersion: "1.0.0",
        kind: "benchmark_manifest",
        payload: {},
        vendor: "openai",
      }).success,
    ).toBe(false);
  });

  it("throws through decodeWire on an invalid envelope", () => {
    expect(() => decodeWire({ protocolVersion: "9.9.9", kind: "x" })).toThrow();
  });
});
