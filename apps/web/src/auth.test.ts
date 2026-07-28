import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestAuthConfig {
  callbacks: {
    authorized(input: {
      auth: null | { user: { id: string; githubLogin: string } };
      request: { nextUrl: { pathname: string } };
    }): boolean;
    session(input: {
      session: { user: { id: string; githubLogin: string } };
      user: { id: string; githubLogin: string };
    }): { user: { id: string; githubLogin: string } };
  };
}

interface TestGitHubOptions {
  profile(input: {
    id: number;
    login: string;
    name: string | null;
    email: string;
    avatar_url: string;
  }): Record<string, unknown>;
}

const mocks = vi.hoisted(() => ({
  nextAuth: vi.fn((_config: TestAuthConfig) => ({
    auth: "auth",
    handlers: "handlers",
    signIn: "signIn",
    signOut: "signOut",
  })),
  github: vi.fn((options: TestGitHubOptions) => ({ options })),
  createAuthAdapter: vi.fn(() => "adapter"),
  createDatabase: vi.fn(() => ({ db: "db" })),
  toAuthContext: vi.fn(() => ({ userId: "user-1" })),
  resolveRouteAccess: vi.fn(() => ({ kind: "allow" })),
  parseWebEnv: vi.fn(() => ({
    databaseUrl: "postgresql://test",
    adminGithubLogins: ["admin"],
    githubClientId: "client",
    githubClientSecret: "secret",
    authSecret: "auth-secret",
  })),
}));

vi.mock("next-auth", () => ({ default: mocks.nextAuth }));
vi.mock("next-auth/providers/github", () => ({ default: mocks.github }));
vi.mock("@llm-bench/control-plane", () => ({
  createAuthAdapter: mocks.createAuthAdapter,
  createDatabase: mocks.createDatabase,
  toAuthContext: mocks.toAuthContext,
}));
vi.mock("@/env", () => ({ parseWebEnv: mocks.parseWebEnv }));
vi.mock("@/route-policy", () => ({
  resolveRouteAccess: mocks.resolveRouteAccess,
}));

describe("Auth.js configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.resolveRouteAccess.mockReturnValue({ kind: "allow" });
  });

  it("wires the database adapter and evaluates route access for anonymous and authenticated requests", async () => {
    const authModule = await import("./auth");
    expect(authModule.auth).toBe("auth");
    expect(mocks.createDatabase).toHaveBeenCalledWith("postgresql://test");
    expect(mocks.createAuthAdapter).toHaveBeenCalledWith("db");

    expect(
      latestAuthConfig().callbacks.authorized({
        auth: null,
        request: { nextUrl: { pathname: "/" } },
      }),
    ).toBe(true);
    mocks.resolveRouteAccess.mockReturnValueOnce({ kind: "deny" });
    expect(
      latestAuthConfig().callbacks.authorized({
        auth: { user: { id: "user-1", githubLogin: "octocat" } },
        request: { nextUrl: { pathname: "/dashboard" } },
      }),
    ).toBe(false);
    expect(mocks.toAuthContext).toHaveBeenCalled();
  });

  it("copies persistent user fields into sessions and maps GitHub profiles", async () => {
    await import("./auth");
    const session = { user: { id: "", githubLogin: "" } };
    expect(
      latestAuthConfig().callbacks.session({
        session,
        user: { id: "user-2", githubLogin: "hubber" },
      }),
    ).toEqual({ user: { id: "user-2", githubLogin: "hubber" } });

    expect(
      latestGitHubOptions().profile({
        id: 42,
        login: "hubber",
        name: null,
        email: "h@example.com",
        avatar_url: "https://example.com/avatar",
      }),
    ).toEqual({
      id: "42",
      name: "hubber",
      email: "h@example.com",
      image: "https://example.com/avatar",
      githubId: "42",
      githubLogin: "hubber",
    });
  });
});

function latestAuthConfig(): TestAuthConfig {
  const config = mocks.nextAuth.mock.calls.at(-1)?.[0];
  if (!config) throw new Error("NextAuth was not configured.");
  return config;
}

function latestGitHubOptions(): TestGitHubOptions {
  const options = mocks.github.mock.calls.at(-1)?.[0];
  if (!options) throw new Error("GitHub was not configured.");
  return options;
}
