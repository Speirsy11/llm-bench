ALTER TABLE "runner_pairings" RENAME COLUMN "user_code" TO "user_code_hash";--> statement-breakpoint
ALTER INDEX "runner_pairings_user_code_unique" RENAME TO "runner_pairings_user_code_hash_unique";--> statement-breakpoint
CREATE INDEX "attempts_runner_status_index" ON "attempts" USING btree ("runner_id","status");--> statement-breakpoint
UPDATE "runners"
SET "capabilities" = '[]'::jsonb
WHERE jsonb_typeof("capabilities") = 'object';--> statement-breakpoint
ALTER TABLE "runners" ALTER COLUMN "capabilities" SET DEFAULT '[]'::jsonb;
