ALTER TABLE "experiments" ADD COLUMN "configuration_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "credential_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"runner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"masked_secret" text NOT NULL,
	"sealed_credential" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD CONSTRAINT "credential_profiles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD CONSTRAINT "credential_profiles_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "retry_of_job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_retry_of_job_id_jobs_id_fk" FOREIGN KEY ("retry_of_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_profiles_owner_id_index" ON "credential_profiles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "credential_profiles_runner_id_index" ON "credential_profiles" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "jobs_retry_of_job_id_index" ON "jobs" USING btree ("retry_of_job_id");
