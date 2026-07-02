import { describe, expect, it } from "vitest";

import { errorFromResponse, ProviderError } from "./errors";

describe("errorFromResponse", () => {
  it("maps auth failures as non-retryable", () => {
    expect(errorFromResponse(401, "")).toMatchObject({
      type: "authentication",
      retryable: false,
      status: 401,
    });
    expect(errorFromResponse(403, "")).toMatchObject({
      type: "authentication",
    });
  });

  it("maps rate limits and server errors as retryable", () => {
    expect(errorFromResponse(429, "")).toMatchObject({
      type: "rate_limit",
      retryable: true,
    });
    expect(errorFromResponse(503, "")).toMatchObject({
      type: "server_error",
      retryable: true,
    });
  });

  it("maps other 4xx as invalid_request", () => {
    expect(errorFromResponse(400, "")).toMatchObject({
      type: "invalid_request",
      retryable: false,
    });
  });

  it("extracts a structured error message", () => {
    const structured = errorFromResponse(
      400,
      JSON.stringify({ error: { message: "bad model", type: "invalid" } }),
    );
    expect(structured.message).toBe("bad model");
  });

  it("extracts a string error field", () => {
    expect(
      errorFromResponse(400, JSON.stringify({ error: "flat message" })).message,
    ).toBe("flat message");
  });

  it("falls back to a default message for opaque bodies", () => {
    expect(errorFromResponse(500, "not json").message).toContain("500");
    expect(
      errorFromResponse(500, JSON.stringify({ nope: 1 })).message,
    ).toContain("500");
    expect(
      errorFromResponse(500, JSON.stringify({ error: { code: 1 } })).message,
    ).toContain("500");
  });

  it("is an Error subclass carrying a cause option", () => {
    const error = new ProviderError("boom", "network", true, null, {
      cause: new Error("root"),
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBeInstanceOf(Error);
  });
});
