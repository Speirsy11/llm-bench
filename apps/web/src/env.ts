import { z } from "zod";

const webEnvSchema = z.object({
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  DATABASE_URL: z
    .url()
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must use the postgres protocol",
    ),
  LLMBENCH_ADMIN_GITHUB_LOGINS: z.string().min(1),
});

export interface WebEnv {
  readonly adminGithubLogins: readonly string[];
  readonly authSecret: string;
  readonly databaseUrl: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
}

export function parseWebEnv(
  environment: Readonly<Record<string, string | undefined>>,
): WebEnv {
  if (environment.SKIP_ENV_VALIDATION === "true") {
    return {
      adminGithubLogins: [],
      authSecret: "00000000000000000000000000000000",
      databaseUrl: "postgresql://build:build@localhost:5432/build",
      githubClientId: "build-client",
      githubClientSecret: "build-secret",
    };
  }
  const parsed = webEnvSchema.parse(environment);
  return {
    adminGithubLogins: parsed.LLMBENCH_ADMIN_GITHUB_LOGINS.split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
    authSecret: parsed.AUTH_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    githubClientId: parsed.AUTH_GITHUB_ID,
    githubClientSecret: parsed.AUTH_GITHUB_SECRET,
  };
}
