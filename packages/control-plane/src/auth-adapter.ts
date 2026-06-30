import type { Adapter } from "@auth/core/adapters";
import { DrizzleAdapter } from "@auth/drizzle-adapter";

import type { createDatabase } from "./database";
import { accounts, sessions, users, verificationTokens } from "./schema";

type Database = ReturnType<typeof createDatabase>["db"];

/** Auth.js adapter bound to the checked-in LLMBench identity/session schema. */
export function createAuthAdapter(database: Database): Adapter {
  return DrizzleAdapter(database, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
}
