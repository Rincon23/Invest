CREATE TABLE "cash_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"reserve_account_amount" numeric DEFAULT 0 NOT NULL,
	"emergency_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reserve_multiplier" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"category_kind" text NOT NULL,
	"topic_id" text,
	"first_debit_date" date NOT NULL,
	"count" integer NOT NULL,
	"total_amount" numeric NOT NULL,
	"accounting" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "installments_category_kind" CHECK ("installments"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable')),
	CONSTRAINT "installments_accounting" CHECK ("installments"."accounting" in ('installment', 'upfront')),
	CONSTRAINT "installments_count" CHECK ("installments"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "investment_buckets" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"topic_id" text,
	"quotas" numeric(18, 8) DEFAULT 0 NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_buckets_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "investment_reserves" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"total_quotas" numeric(18, 8) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_cache" (
	"ticker" text PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"category_kind" text NOT NULL,
	"topic_id" text,
	"description" text NOT NULL,
	"amount" numeric NOT NULL,
	"card" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expenses_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "recurring_expenses_category_kind" CHECK ("recurring_expenses"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable'))
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "installment_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "installment_number" integer;--> statement-breakpoint
ALTER TABLE "cash_settings" ADD CONSTRAINT "cash_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_buckets" ADD CONSTRAINT "investment_buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_reserves" ADD CONSTRAINT "investment_reserves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_installment_unique" UNIQUE("user_id","installment_id","installment_number");