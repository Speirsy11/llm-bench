import { describe, expect, it } from "vitest";

import { AgenticTaskSchema, ResponseCaseSchema } from "./workload";

describe("ResponseCaseSchema", () => {
  it("defaults to three repetitions when unspecified", () => {
    const result = ResponseCaseSchema.parse({
      id: "json-extract",
      prompt: "Return the address as JSON.",
    });

    expect(result.repetitions).toBe(3);
  });

  it("rejects a non-positive repetition count", () => {
    expect(
      ResponseCaseSchema.safeParse({
        id: "json-extract",
        prompt: "Return the address as JSON.",
        repetitions: 0,
      }).success,
    ).toBe(false);
  });
});

describe("AgenticTaskSchema", () => {
  it("defaults to a single repetition and validates a typescript task", () => {
    const result = AgenticTaskSchema.parse({
      id: "ts-null-guard",
      language: "typescript",
      constraints: ["Do not edit the public API."],
    });

    expect(result.repetitions).toBe(1);
  });

  it("rejects a language outside typescript and python", () => {
    expect(
      AgenticTaskSchema.safeParse({
        id: "go-task",
        language: "go",
        constraints: [],
      }).success,
    ).toBe(false);
  });
});
