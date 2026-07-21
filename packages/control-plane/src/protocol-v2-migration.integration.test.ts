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

const migrationNames = [
  "0000_identity-experiments.sql",
  "0001_control-plane-schema.sql",
  "0002_unique-user-email.sql",
  "0003_worried_prism.sql",
  "0004_violet_miss_america.sql",
  "0005_boring_mathemanic.sql",
  "0006_dashboard_experiment_tracer.sql",
] as const;

describe("protocol-v2 migration", () => {
  it("quarantines pre-v2 work and pairings without fabricating executable snapshots", async () => {
    await resetTestDatabase(connectionString);
    const sql = postgres(connectionString, { max: 1 });
    try {
      for (const migrationName of migrationNames) {
        await executeMigration(sql, migrationName);
      }
      await sql.unsafe(`
        insert into users (id, github_id, github_login)
        values ('legacy-owner', 'legacy-owner', 'legacy-owner');
        insert into runners (
          id, owner_id, name, public_key, protocol_version, token_hash,
          status, capabilities, environment
        ) values (
          '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'legacy-owner',
          'legacy runner', 'legacy-der-key', '1.0', 'legacy-token',
          'online', '[]'::jsonb, '{}'::jsonb
        );
        insert into runner_pairings (
          device_code_hash, user_code_hash, request, expires_at, consumed_at
        ) values
          ('legacy-pending', 'legacy-pending-user', '{"protocolVersion":"1.0"}'::jsonb, now() + interval '1 hour', null),
          ('legacy-consumed', 'legacy-consumed-user', '{"protocolVersion":"1.0"}'::jsonb, now() + interval '1 hour', now()),
          ('v2-pending', 'v2-pending-user', '{"protocolVersion":"2.0"}'::jsonb, now() + interval '1 hour', null);
        insert into experiments (id, owner_id, name)
        values ('eb171b20-3ca1-44db-b4d2-63f97a7350aa', 'legacy-owner', 'legacy experiment');
        insert into targets (
          id, experiment_id, position, model_route, harness, toolset
        ) values (
          '646a683c-e619-4cc7-9928-e3a7a6c75674',
          'eb171b20-3ca1-44db-b4d2-63f97a7350aa', 0,
          '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
        );
        insert into jobs (
          id, experiment_id, target_id, runner_id, status,
          benchmark_id, benchmark_version
        ) values
          ('69530474-e7f1-48cd-b36a-22bf70e388bf', 'eb171b20-3ca1-44db-b4d2-63f97a7350aa', '646a683c-e619-4cc7-9928-e3a7a6c75674', '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'running', 'repository-repair', '1.0.0'),
          ('2fa8589b-ce05-4cab-bfaa-149c3c73310c', 'eb171b20-3ca1-44db-b4d2-63f97a7350aa', '646a683c-e619-4cc7-9928-e3a7a6c75674', '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'completed', 'repository-repair', '1.0.0');
        insert into attempts (
          id, job_id, number, status, runner_id, lease_token_hash, terminal
        ) values
          ('145628d8-1440-4af4-9a64-570e24199f0d', '69530474-e7f1-48cd-b36a-22bf70e388bf', 1, 'running', '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'lease', null),
          ('ca428d5d-f01b-4a06-b5f0-8118b00a1b84', '2fa8589b-ce05-4cab-bfaa-149c3c73310c', 1, 'completed', '70b70847-ec1c-4aeb-ac0f-bf7db0328efe', 'lease', '{"status":"completed"}'::jsonb);
      `);

      await executeMigration(sql, "0007_execution_aware_leases.sql");

      const jobRows = await sql<
        {
          id: string;
          status: string;
          execution: unknown;
          workload: unknown;
          limits: unknown;
        }[]
      >`select id, status, execution, workload, limits from jobs order by id`;
      expect(jobRows).toEqual([
        {
          id: "2fa8589b-ce05-4cab-bfaa-149c3c73310c",
          status: "completed",
          execution: null,
          workload: null,
          limits: null,
        },
        {
          id: "69530474-e7f1-48cd-b36a-22bf70e388bf",
          status: "interrupted",
          execution: null,
          workload: null,
          limits: null,
        },
      ]);
      const attemptRows = await sql<
        { id: string; status: string; terminal: unknown }[]
      >`select id, status, terminal from attempts order by id`;
      expect(attemptRows).toEqual([
        {
          id: "145628d8-1440-4af4-9a64-570e24199f0d",
          status: "interrupted",
          terminal: {
            attemptId: "145628d8-1440-4af4-9a64-570e24199f0d",
            status: "interrupted",
            observations: [],
            artifacts: [],
            error: { kind: "protocol_v2_migration" },
          },
        },
        {
          id: "ca428d5d-f01b-4a06-b5f0-8118b00a1b84",
          status: "completed",
          terminal: { status: "completed" },
        },
      ]);
      await expect(
        sql`select device_code_hash from runner_pairings`,
      ).resolves.toEqual([]);
      await expect(
        sql`select status, protocol_version, token_hash, revoked_at is not null as revoked from runners`,
      ).resolves.toEqual([
        {
          status: "disabled",
          protocol_version: "1.0",
          token_hash: null,
          revoked: true,
        },
      ]);
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
