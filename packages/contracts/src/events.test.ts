import { describe, expect, it } from "vitest";

import {
  ArtifactSchema,
  BenchmarkEventSchema,
  CheckpointSchema,
  FailureSchema,
} from "./events";

describe("BenchmarkEventSchema", () => {
  it("validates a case_completed event carrying metric observations", () => {
    const result = BenchmarkEventSchema.safeParse({
      type: "case_completed",
      at: "2026-06-30T19:00:00.000Z",
      caseId: "json-extract",
      observations: [{ metricId: "pass_ratio", value: 1 }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an event with an unknown discriminator", () => {
    expect(
      BenchmarkEventSchema.safeParse({
        type: "case_skipped",
        at: "2026-06-30T19:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("FailureSchema", () => {
  it("validates an incompatible-capabilities failure listing the gap", () => {
    const result = FailureSchema.safeParse({
      kind: "incompatible_capabilities",
      missing: ["workspaces"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an incompatible-capabilities failure with no missing items", () => {
    expect(
      FailureSchema.safeParse({
        kind: "incompatible_capabilities",
        missing: [],
      }).success,
    ).toBe(false);
  });

  it("validates a timeout failure carrying the breached limit", () => {
    expect(
      FailureSchema.safeParse({ kind: "timeout", limitMs: 600000 }).success,
    ).toBe(true);
  });
});

describe("CheckpointSchema", () => {
  it("validates a resumable checkpoint with opaque state", () => {
    expect(
      CheckpointSchema.safeParse({
        jobId: "job-1",
        sequence: 4,
        resumable: true,
        state: { cursor: "abc" },
      }).success,
    ).toBe(true);
  });
});

describe("ArtifactSchema", () => {
  it("validates a content-addressed artifact record", () => {
    expect(
      ArtifactSchema.safeParse({
        id: "artifact-1",
        jobId: "job-1",
        contentHash: "sha256:deadbeef",
        byteSize: 2048,
        mediaType: "application/json",
      }).success,
    ).toBe(true);
  });
});
