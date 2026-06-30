import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 5 });
  return {
    client,
    db: drizzle(client, { schema }),
    close: async () => client.end(),
  };
}

export async function migrateDatabase(connectionString: string): Promise<void> {
  const database = createDatabase(connectionString);
  try {
    await migrate(database.db, {
      migrationsFolder: join(import.meta.dirname, "..", "drizzle"),
    });
  } finally {
    await database.close();
  }
}

export async function resetTestDatabase(
  connectionString: string,
): Promise<void> {
  if (!/(_test|test_)/.test(new URL(connectionString).pathname)) {
    throw new Error(
      "Refusing to reset a database whose name is not marked test.",
    );
  }
  const client = postgres(connectionString, { max: 1 });
  try {
    await client.unsafe("drop schema if exists public cascade");
    await client.unsafe("drop schema if exists drizzle cascade");
    await client.unsafe("create schema public");
  } finally {
    await client.end();
  }
}
