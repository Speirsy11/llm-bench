ALTER TABLE "experiments" ADD COLUMN "public_snapshot" jsonb;--> statement-breakpoint
UPDATE "experiments"
SET
  "visibility" = 'private',
  "curated_at" = NULL,
  "curated_by" = NULL
WHERE "visibility" = 'public';--> statement-breakpoint
ALTER TABLE "experiments" DROP CONSTRAINT "experiments_curated_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_curated_by_users_id_fk" FOREIGN KEY ("curated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_public_snapshot_check" CHECK (
  "visibility" <> 'public'
  OR (
    "curated_at" IS NOT NULL
    AND "curated_by" IS NOT NULL
    AND "public_snapshot" IS NOT NULL
  )
);
