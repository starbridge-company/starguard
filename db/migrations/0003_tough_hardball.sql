CREATE TYPE "starguard"."finding_status" AS ENUM('open', 'fixed', 'pr_open', 'pr_merged', 'false_positive', 'accepted_risk');--> statement-breakpoint
CREATE TABLE "starguard"."finding_fixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"model" text,
	"instructions" text,
	"original_code" text NOT NULL,
	"fixed_code" text NOT NULL,
	"changed_files" jsonb,
	"explanation" text,
	"no_change" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "starguard"."findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"local_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"repo_url" text,
	"source" text NOT NULL,
	"rule_id" text NOT NULL,
	"severity" text NOT NULL,
	"file" text,
	"line" integer,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "starguard"."finding_status" DEFAULT 'open' NOT NULL,
	"status_note" text,
	"status_by" uuid,
	"status_at" timestamp with time zone,
	"inherited_from" uuid,
	"pull_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "starguard"."finding_fixes" ADD CONSTRAINT "finding_fixes_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "starguard"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."finding_fixes" ADD CONSTRAINT "finding_fixes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."findings" ADD CONSTRAINT "findings_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "starguard"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."findings" ADD CONSTRAINT "findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."findings" ADD CONSTRAINT "findings_status_by_users_id_fk" FOREIGN KEY ("status_by") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."findings" ADD CONSTRAINT "findings_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "starguard"."pull_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_fixes_finding_idx" ON "starguard"."finding_fixes" USING btree ("finding_id","superseded_at");--> statement-breakpoint
CREATE INDEX "findings_analysis_idx" ON "starguard"."findings" USING btree ("analysis_id","severity");--> statement-breakpoint
CREATE INDEX "findings_fp_idx" ON "starguard"."findings" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_analysis_local_uidx" ON "starguard"."findings" USING btree ("analysis_id","local_id");