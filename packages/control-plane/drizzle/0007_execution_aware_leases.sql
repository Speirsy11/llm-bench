ALTER TABLE "runners" ALTER COLUMN "protocol_version" SET DEFAULT '2.0';--> statement-breakpoint
UPDATE "runners"
SET "status" = 'disabled',
	"revoked_at" = COALESCE("revoked_at", now()),
	"token_hash" = NULL,
	"updated_at" = now()
WHERE "protocol_version" <> '2.0';--> statement-breakpoint
UPDATE "attempts"
SET "status" = 'interrupted',
	"terminal" = jsonb_build_object(
		'attemptId', "id",
		'status', 'interrupted',
		'observations', '[]'::jsonb,
		'artifacts', '[]'::jsonb,
		'error', jsonb_build_object('kind', 'protocol_v2_migration')
	)
WHERE "status" IN ('queued', 'leased', 'preparing', 'running', 'grading', 'uploading');--> statement-breakpoint
UPDATE "jobs"
SET "status" = 'interrupted', "updated_at" = now()
WHERE "status" IN ('queued', 'leased', 'preparing', 'running', 'grading', 'uploading');--> statement-breakpoint
DELETE FROM "runner_pairings"
WHERE "consumed_at" IS NULL
	OR "request"->>'protocolVersion' IS DISTINCT FROM '2.0';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "credential_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "execution" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "workload" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "limits" jsonb;--> statement-breakpoint
UPDATE "jobs" AS "job"
SET "credential_profile_id" = "credential"."id"
FROM "experiments" AS "experiment", "credential_profiles" AS "credential"
WHERE "job"."experiment_id" = "experiment"."id"
	AND "credential"."id"::text = "experiment"."configuration_snapshot"->>'credentialProfileId';--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_credential_profile_id_credential_profiles_id_fk" FOREIGN KEY ("credential_profile_id") REFERENCES "public"."credential_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_nonterminal_execution_check" CHECK ("status" IN ('completed', 'failed', 'cancelled', 'interrupted') OR "execution" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "jobs_credential_profile_id_index" ON "jobs" USING btree ("credential_profile_id");
