import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { resetTestDatabase } from "./database";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required for Postgres integration tests.",
  );
}

const priorMigrations = [
  "0000_identity-experiments.sql",
  "0001_control-plane-schema.sql",
  "0002_unique-user-email.sql",
  "0003_worried_prism.sql",
  "0004_violet_miss_america.sql",
  "0005_boring_mathemanic.sql",
  "0006_dashboard_experiment_tracer.sql",
  "0007_execution_aware_leases.sql",
] as const;

describe("protocol-v3 inventory migration", () => {
  it("adds sanitized empty inventory and disables incompatible paired runners", async () => {
    await resetTestDatabase(connectionString);
    const sql = postgres(connectionString, { max: 1 });
    try {
      for (const migration of priorMigrations) {
        await executeMigration(sql, migration);
      }
      await sql.unsafe(`
        insert into users (id, github_id, github_login)
        values ('inventory-owner', 'inventory-owner', 'inventory-owner');
        insert into runners (
          id, owner_id, name, public_key, protocol_version, token_hash,
          status, capabilities, environment
        ) values (
          '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'inventory-owner',
          'v2 runner', 'legacy-key', '2.0', 'legacy-token',
          'online', '[]'::jsonb, '{}'::jsonb
        );
      `);

      await executeMigration(sql, "0008_runner_inventory.sql");

      await expect(
        sql`select protocol_version, status, inventory from runners`,
      ).resolves.toEqual([
        {
          protocol_version: "2.0",
          status: "disabled",
          inventory: { plugins: [], mcpProfiles: [] },
        },
      ]);

      const [fresh] = await sql<
        { protocol_version: string; inventory: unknown }[]
      >`
        insert into runners (owner_id, name, public_key)
        values ('inventory-owner', 'v3 runner', 'current-key')
        returning protocol_version, inventory
      `;
      expect(fresh).toEqual({
        protocol_version: "3.0",
        inventory: { plugins: [], mcpProfiles: [] },
      });
    } finally {
      await sql.end();
    }
  }, 120_000);
});

async function executeMigration(
  sql: postgres.Sql,
  migrationName: string,
): Promise<void> {
  const contents = await readFile(
    join(import.meta.dirname, "..", "drizzle", migrationName),
    "utf8",
  );
  for (const statement of contents.split("--> statement-breakpoint")) {
    if (statement.trim().length > 0) await sql.unsafe(statement);
  }
}
