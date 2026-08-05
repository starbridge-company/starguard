CREATE TABLE "starguard"."ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"purpose" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"repo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "starguard"."ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_month_idx" ON "starguard"."ai_usage" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "starguard"."ai_usage" USING btree ("created_at" DESC NULLS LAST);