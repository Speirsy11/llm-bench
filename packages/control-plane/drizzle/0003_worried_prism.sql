CREATE TABLE "runner_events" (
	"attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_events_attempt_id_sequence_pk" PRIMARY KEY("attempt_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "runner_pairings" (
	"device_code_hash" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"request" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"owner_id" text,
	"runner_id" uuid,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "runner_id" uuid;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "lease_token_hash" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "terminal" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "benchmark_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "benchmark_version" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "queue_position" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "jobs_queue_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cancellation_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "protocol_version" text DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runner_events" ADD CONSTRAINT "runner_events_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_pairings" ADD CONSTRAINT "runner_pairings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_pairings" ADD CONSTRAINT "runner_pairings_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runner_pairings_user_code_unique" ON "runner_pairings" USING btree ("user_code");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;