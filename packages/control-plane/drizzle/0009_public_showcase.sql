ALTER TABLE "experiments" ADD COLUMN "public_snapshot" jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "experiments" WHERE "visibility" = 'public') THEN
    RAISE EXCEPTION 'Public experiments require an explicit withdraw-or-backfill decision before applying migration 0009';
  END IF;
END
$$;--> statement-breakpoint
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
