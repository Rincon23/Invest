CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"name" text,
	"suggested_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"authorize_expires_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone,
	"next_auto_sync_at" timestamp with time zone,
	"consent_expires_at" timestamp with time zone,
	"synced_update_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_user_id_item_id_pk" PRIMARY KEY("user_id","item_id"),
	CONSTRAINT "bank_connections_status" CHECK ("bank_connections"."status" in ('pending', 'ok', 'error', 'reconnect'))
);
--> statement-breakpoint
CREATE TABLE "bank_investments" (
	"user_id" uuid NOT NULL,
	"investment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"subtype" text,
	"code" text,
	"isin" text,
	"quantity" numeric(24, 8),
	"balance" numeric,
	"balance_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_investments_user_id_investment_id_pk" PRIMARY KEY("user_id","investment_id")
);
--> statement-breakpoint
CREATE TABLE "bank_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"secret_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagram_answers" (
	"user_id" uuid NOT NULL,
	"asset_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" integer NOT NULL,
	CONSTRAINT "diagram_answers_user_id_asset_id_question_id_pk" PRIMARY KEY("user_id","asset_id","question_id"),
	CONSTRAINT "diagram_answers_answer" CHECK ("diagram_answers"."answer" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "diagram_assets" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric(24, 8) DEFAULT 0 NOT NULL,
	"quantity_updated_on" date,
	"sector" text,
	"subsector" text,
	"note" text,
	"stop_buying" boolean DEFAULT false NOT NULL,
	"is_etf" boolean DEFAULT false NOT NULL,
	"direct_score" numeric,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_assets_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "diagram_assets_ticker_unique" UNIQUE("user_id","type","ticker"),
	CONSTRAINT "diagram_assets_type" CHECK ("diagram_assets"."type" in ('brStocks', 'intlStocks', 'fiis', 'reits', 'crypto', 'fixedIncome', 'intlFixedIncome')),
	CONSTRAINT "diagram_assets_quantity" CHECK ("diagram_assets"."quantity" >= 0),
	CONSTRAINT "diagram_assets_direct_score" CHECK ("diagram_assets"."direct_score" is null or "diagram_assets"."direct_score" between -1 and 1)
);
--> statement-breakpoint
CREATE TABLE "diagram_contributions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_contributions_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "diagram_fixed_income" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric DEFAULT 0 NOT NULL,
	"updated_on" date,
	"score" numeric DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_fixed_income_user_id_type_pk" PRIMARY KEY("user_id","type"),
	CONSTRAINT "diagram_fixed_income_type" CHECK ("diagram_fixed_income"."type" in ('fixedIncome', 'intlFixedIncome')),
	CONSTRAINT "diagram_fixed_income_amount" CHECK ("diagram_fixed_income"."amount" >= 0),
	CONSTRAINT "diagram_fixed_income_score" CHECK ("diagram_fixed_income"."score" between -1 and 1)
);
--> statement-breakpoint
CREATE TABLE "diagram_outside" (
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"quantity" numeric(24, 8),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_outside_user_id_ticker_pk" PRIMARY KEY("user_id","ticker"),
	CONSTRAINT "diagram_outside_quantity" CHECK ("diagram_outside"."quantity" is null or "diagram_outside"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "diagram_questions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"criterion" text NOT NULL,
	"text" text NOT NULL,
	"help" text,
	"auto" text,
	"weight" numeric DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_questions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "diagram_questions_type" CHECK ("diagram_questions"."type" in ('brStocks', 'intlStocks', 'fiis', 'reits', 'crypto')),
	CONSTRAINT "diagram_questions_weight" CHECK ("diagram_questions"."weight" >= 0),
	CONSTRAINT "diagram_questions_auto" CHECK ("diagram_questions"."auto" is null or "diagram_questions"."auto" in ('graham', 'pvp'))
);
--> statement-breakpoint
CREATE TABLE "diagram_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_amount" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundamentals_cache" (
	"ticker" text PRIMARY KEY NOT NULL,
	"lpa" numeric,
	"vpa" numeric,
	"pvp" numeric,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "module_access" (
	"module_key" text PRIMARY KEY NOT NULL,
	"vip_only" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"source_key" text,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_source_unique" UNIQUE("user_id","source_key")
);
--> statement-breakpoint
CREATE TABLE "price_cache" (
	"ticker" text PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"name" text,
	"source" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history_cache" (
	"symbol" text NOT NULL,
	"range" text NOT NULL,
	"points" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_cache_symbol_range_pk" PRIMARY KEY("symbol","range")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "self_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"results" jsonb NOT NULL,
	"failed" integer NOT NULL,
	"warned" integer NOT NULL,
	CONSTRAINT "self_test_runs_trigger" CHECK ("self_test_runs"."trigger" in ('start', 'schedule', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"onboarding_completed" boolean DEFAULT true NOT NULL,
	"modules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissed_notices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"home_pages" jsonb,
	"home_card_sizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"home_hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD CONSTRAINT "bank_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD CONSTRAINT "bank_investments_user_id_item_id_bank_connections_user_id_item_id_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."bank_connections"("user_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_keys" ADD CONSTRAINT "bank_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_answers" ADD CONSTRAINT "diagram_answers_user_id_asset_id_diagram_assets_user_id_id_fk" FOREIGN KEY ("user_id","asset_id") REFERENCES "public"."diagram_assets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_answers" ADD CONSTRAINT "diagram_answers_user_id_question_id_diagram_questions_user_id_id_fk" FOREIGN KEY ("user_id","question_id") REFERENCES "public"."diagram_questions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_contributions" ADD CONSTRAINT "diagram_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_fixed_income" ADD CONSTRAINT "diagram_fixed_income_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_outside" ADD CONSTRAINT "diagram_outside_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_questions" ADD CONSTRAINT "diagram_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_settings" ADD CONSTRAINT "diagram_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vip_users" ADD CONSTRAINT "vip_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "diagram_contributions_user_date_idx" ON "diagram_contributions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "self_test_runs_started_idx" ON "self_test_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");