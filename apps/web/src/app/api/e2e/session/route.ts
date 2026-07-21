import { randomBytes } from "node:crypto";
import { parseWebEnv } from "@/env";

import {
  createAuthAdapter,
  createControlPlane,
  createDatabase,
} from "@llm-bench/control-plane";

import { rejectUnauthorizedE2eRequest, requireTestDatabaseUrl } from "../guard";

const SESSION_LIFETIME_MS = 5 * 60 * 1000;

export async function GET(request: Request): Promise<Response> {
  const rejection = rejectUnauthorizedE2eRequest(request);
  if (rejection) return rejection;
  const connectionString = requireTestDatabaseUrl(
    parseWebEnv(process.env).databaseUrl,
  );
  const sessionToken = randomBytes(32).toString("hex");
  const controlPlane = createControlPlane({ connectionString });
  const database = createDatabase(connectionString);
  try {
    const user = await controlPlane.users.upsertGitHubIdentity({
      githubId: "llm-bench-e2e-user",
      githubLogin: "llm-bench-e2e",
      name: "E2E User",
    });
    const adapter = createAuthAdapter(database.db);
    await adapter.createSession?.({
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + SESSION_LIFETIME_MS),
    });
  } finally {
    await Promise.all([controlPlane.close(), database.close()]);
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: "/e2e/dashboard-tracer",
      "set-cookie": `authjs.session-token=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300`,
    },
  });
}
