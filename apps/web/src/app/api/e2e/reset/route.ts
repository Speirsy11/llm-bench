import { parseWebEnv } from "@/env";

import { createDatabase } from "@llm-bench/control-plane";

import { rejectUnauthorizedE2eRequest, requireTestDatabaseUrl } from "../guard";

export async function POST(request: Request): Promise<Response> {
  const rejection = rejectUnauthorizedE2eRequest(request);
  if (rejection) return rejection;
  const connectionString = requireTestDatabaseUrl(
    parseWebEnv(process.env).databaseUrl,
  );
  const database = createDatabase(connectionString);
  try {
    await database.client.unsafe(
      "truncate table users, runner_pairings restart identity cascade",
    );
    return Response.json({ reset: true });
  } finally {
    await database.close();
  }
}
