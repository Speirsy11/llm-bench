import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as persistence } from "./persistence/route";
import { POST as reset } from "./reset/route";
import { GET as session } from "./session/route";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  unsafe: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  upsertGitHubIdentity: vi.fn(),
  deleteSession: vi.fn(),
  createSession: vi.fn(),
  createDatabase: vi.fn(),
  createControlPlane: vi.fn(),
  createAuthAdapter: vi.fn(),
  requireTestDatabaseUrl: vi.fn((value: string) => value),
  parseWebEnv: vi.fn(() => ({ databaseUrl: "postgresql://test/e2e_test" })),
}));

vi.mock("./guard", () => ({
  rejectUnauthorizedE2eRequest: () => null,
  requireTestDatabaseUrl: mocks.requireTestDatabaseUrl,
}));
vi.mock("@/env", () => ({ parseWebEnv: mocks.parseWebEnv }));
vi.mock("@llm-bench/control-plane", () => ({
  artifacts: "artifacts",
  attempts: "attempts",
  credentialProfiles: "credentialProfiles",
  jobs: "jobs",
  metrics: "metrics",
  results: "results",
  runnerEvents: "runnerEvents",
  createDatabase: mocks.createDatabase,
  createControlPlane: mocks.createControlPlane,
  createAuthAdapter: mocks.createAuthAdapter,
}));

describe("authorized E2E fixture routes", () => {
  beforeEach(() => {
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.unsafe.mockReset().mockResolvedValue(undefined);
    mocks.from.mockReset().mockResolvedValue([{ id: "row" }]);
    mocks.select.mockReset().mockReturnValue({ from: mocks.from });
    mocks.upsertGitHubIdentity
      .mockReset()
      .mockResolvedValue({ id: "e2e-user" });
    mocks.deleteSession.mockReset().mockResolvedValue(undefined);
    mocks.createSession.mockReset().mockResolvedValue(undefined);
    mocks.requireTestDatabaseUrl.mockClear();
    mocks.createAuthAdapter.mockReset().mockReturnValue({
      deleteSession: mocks.deleteSession,
      createSession: mocks.createSession,
    });
    mocks.createDatabase.mockReset().mockReturnValue({
      db: { select: mocks.select },
      client: { unsafe: mocks.unsafe },
      close: mocks.close,
    });
    mocks.createControlPlane.mockReset().mockReturnValue({
      users: { upsertGitHubIdentity: mocks.upsertGitHubIdentity },
      close: mocks.close,
    });
  });

  it("returns the persistence audit and closes its database", async () => {
    const response = await persistence(new Request("http://example.test"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { persisted: unknown[] };
    expect(body.persisted).toHaveLength(7);
    expect(mocks.from).toHaveBeenCalledWith("artifacts");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("truncates the disposable fixture database", async () => {
    const response = await reset(
      new Request("http://example.test", { method: "POST" }),
    );
    await expect(response.json()).resolves.toEqual({ reset: true });
    expect(mocks.unsafe).toHaveBeenCalledWith(
      "truncate table users, runner_pairings restart identity cascade",
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("creates a real database session fixture and redirects", async () => {
    const before = Date.now();
    const response = await session(new Request("http://example.test"));
    const after = Date.now();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/e2e/dashboard-tracer");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      /^authjs\.session-token=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=300$/u,
    );
    const sessionToken = /^authjs\.session-token=([^;]+)/u.exec(cookie)?.[1];
    const created = mocks.createSession.mock.calls[0]?.[0] as
      | { sessionToken: string; userId: string; expires: Date }
      | undefined;
    expect(created).toMatchObject({ sessionToken, userId: "e2e-user" });
    expect(created?.expires.getTime()).toBeGreaterThan(before);
    expect(created?.expires.getTime()).toBeLessThanOrEqual(
      after + 5 * 60 * 1000,
    );
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.requireTestDatabaseUrl).toHaveBeenCalledWith(
      "postgresql://test/e2e_test",
    );
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
