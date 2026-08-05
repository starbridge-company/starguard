CREATE TYPE "starguard"."job_status" AS ENUM('queued', 'running', 'done', 'error', 'dead');--> statement-breakpoint
CREATE TABLE "starguard"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "starguard"."job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" uuid,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "starguard"."jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "starguard"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "starguard"."jobs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "starguard"."jobs" USING btree ("dedupe_key");