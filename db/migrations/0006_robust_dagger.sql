CREATE TABLE "starguard"."oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "starguard"."oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"family_id" uuid NOT NULL,
	"current_jti" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "starguard"."oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starguard"."oauth_sessions" ADD CONSTRAINT "oauth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "starguard"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_expires_idx" ON "starguard"."oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_sessions_family_idx" ON "starguard"."oauth_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_sessions_user_idx" ON "starguard"."oauth_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "oauth_sessions_jti_idx" ON "starguard"."oauth_sessions" USING btree ("current_jti");