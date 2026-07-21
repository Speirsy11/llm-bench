import { afterEach, describe, expect, it, vi } from "vitest";

import {
  E2E_TOKEN_HEADER,
  rejectUnauthorizedE2eRequest,
  requireTestDatabaseUrl,
} from "./guard";
import { GET as inspectPersistence } from "./persistence/route";
import { POST as resetPersistence } from "./reset/route";
import { GET as createSession } from "./session/route";

describe("E2E route guard", () => {
  const originalEnabled = process.env.LLMBENCH_E2E_ENABLED;
  const originalToken = process.env.LLMBENCH_E2E_TOKEN;

  afterEach(() => {
    vi.unstubAllEnvs();
    restore("LLMBENCH_E2E_ENABLED", originalEnabled);
    restore("LLMBENCH_E2E_TOKEN", originalToken);
  });

  it("hides fixture routes unless the explicit E2E mode is enabled", async () => {
    delete process.env.LLMBENCH_E2E_ENABLED;
    delete process.env.LLMBENCH_E2E_TOKEN;

    const rejection = rejectUnauthorizedE2eRequest(
      new Request("http://localhost/api/e2e/reset"),
    );

    expect(rejection?.status).toBe(404);
    await expect(rejection?.json()).resolves.toEqual({ error: "Not found." });

    const request = new Request("http://localhost/api/e2e/fixture");
    await expect(resetPersistence(request)).resolves.toMatchObject({
      status: 404,
    });
    await expect(inspectPersistence(request)).resolves.toMatchObject({
      status: 404,
    });
    await expect(createSession(request)).resolves.toMatchObject({
      status: 404,
    });
  });

  it("requires the configured high-entropy token in a request header", () => {
    process.env.LLMBENCH_E2E_ENABLED = "1";
    process.env.LLMBENCH_E2E_TOKEN = "a".repeat(48);

    expect(
      rejectUnauthorizedE2eRequest(
        new Request("http://localhost/api/e2e/reset", {
          headers: { [E2E_TOKEN_HEADER]: "wrong" },
        }),
      )?.status,
    ).toBe(404);
    expect(
      rejectUnauthorizedE2eRequest(
        new Request("http://localhost/api/e2e/reset", {
          headers: { [E2E_TOKEN_HEADER]: "a".repeat(48) },
        }),
      ),
    ).toBeNull();
  });

  it("remains hidden in production even with the correct token", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.LLMBENCH_E2E_ENABLED = "1";
    process.env.LLMBENCH_E2E_TOKEN = "a".repeat(48);

    expect(
      rejectUnauthorizedE2eRequest(
        new Request("http://localhost/api/e2e/reset", {
          headers: { [E2E_TOKEN_HEADER]: "a".repeat(48) },
        }),
      )?.status,
    ).toBe(404);
  });

  it("rejects any E2E database without an explicit test name", () => {
    expect(() =>
      requireTestDatabaseUrl("postgresql://db.example/llmbench"),
    ).toThrow("test-named database");
    expect(() =>
      requireTestDatabaseUrl("postgresql://localhost/contest_prod"),
    ).toThrow("test-named database");
    expect(
      requireTestDatabaseUrl("postgresql://localhost/llmbench_e2e_test"),
    ).toContain("llmbench_e2e_test");
    expect(
      requireTestDatabaseUrl("postgresql://localhost/test_llmbench_e2e"),
    ).toContain("test_llmbench_e2e");
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
