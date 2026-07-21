import { parseWebEnv } from "@/env";

import {
  artifacts,
  attempts,
  createDatabase,
  credentialProfiles,
  jobs,
  metrics,
  results,
  runnerEvents,
} from "@llm-bench/control-plane";

import { rejectUnauthorizedE2eRequest, requireTestDatabaseUrl } from "../guard";

export async function GET(request: Request): Promise<Response> {
  const rejection = rejectUnauthorizedE2eRequest(request);
  if (rejection) return rejection;
  const database = createDatabase(
    requireTestDatabaseUrl(parseWebEnv(process.env).databaseUrl),
  );
  try {
    const persisted = await Promise.all([
      database.db.select().from(credentialProfiles),
      database.db.select().from(jobs),
      database.db.select().from(attempts),
      database.db.select().from(results),
      database.db.select().from(metrics),
      database.db.select().from(runnerEvents),
      database.db.select().from(artifacts),
    ]);
    return Response.json({ persisted });
  } finally {
    await database.close();
  }
}
