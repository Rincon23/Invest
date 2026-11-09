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
CREATE TABLE "budget_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"topics" jsonb NOT NULL,
	"special_categories" jsonb NOT NULL,
	"special_category_colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"month" text NOT NULL,
	"category_kind" text NOT NULL,
	"topic_id" text,
	"description" text NOT NULL,
	"amount" numeric NOT NULL,
	"date" date NOT NULL,
	"card" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "expenses_category_kind" CHECK ("expenses"."category_kind" in ('topic', 'fixedCost', 'unforeseen'))
);
--> statement-breakpoint
CREATE TABLE "incomes" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"month" text NOT NULL,
	"source" text NOT NULL,
	"amount" numeric NOT NULL,
	"date" date,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incomes_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "months" (
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"carry_in" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"topics_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "months_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "months_month_format" CHECK ("months"."month" ~ '^[0-9]{4}-[0-9]{2}$')
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
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD CONSTRAINT "budget_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_month_months_user_id_month_fk" FOREIGN KEY ("user_id","month") REFERENCES "public"."months"("user_id","month") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_user_id_month_months_user_id_month_fk" FOREIGN KEY ("user_id","month") REFERENCES "public"."months"("user_id","month") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "months" ADD CONSTRAINT "months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "expenses_user_month_idx" ON "expenses" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "incomes_user_month_idx" ON "incomes" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");