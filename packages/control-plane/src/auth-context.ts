import type { AuthContext } from "./access-policy";

export interface AuthSession {
  readonly user: {
    readonly id: string;
    readonly githubLogin: string;
  };
}

/** Convert framework session data into the domain authorization vocabulary. */
export function toAuthContext(
  session: AuthSession,
  adminGithubLogins: readonly string[],
): AuthContext {
  const adminLogins = new Set(
    adminGithubLogins.map((login) => login.toLowerCase()),
  );
  return {
    userId: session.user.id,
    githubLogin: session.user.githubLogin,
    isAdmin: adminLogins.has(session.user.githubLogin.toLowerCase()),
  };
}
