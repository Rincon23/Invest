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
	CONSTRAINT "diagram_assets_type" CHECK ("diagram_assets"."type" in ('brStocks', 'intlStocks', 'fiis', 'reits', 'crypto')),
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
	"expense_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_contributions_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "diagram_fixed_income" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric DEFAULT 0 NOT NULL,
	"updated_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_fixed_income_user_id_type_pk" PRIMARY KEY("user_id","type"),
	CONSTRAINT "diagram_fixed_income_type" CHECK ("diagram_fixed_income"."type" in ('fixedIncome', 'intlFixedIncome')),
	CONSTRAINT "diagram_fixed_income_amount" CHECK ("diagram_fixed_income"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diagram_questions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"criterion" text NOT NULL,
	"text" text NOT NULL,
	"help" text,
	"weight" numeric DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagram_questions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "diagram_questions_type" CHECK ("diagram_questions"."type" in ('brStocks', 'intlStocks', 'fiis', 'reits', 'crypto')),
	CONSTRAINT "diagram_questions_weight" CHECK ("diagram_questions"."weight" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diagram_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_amount" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagram_answers" ADD CONSTRAINT "diagram_answers_user_id_asset_id_diagram_assets_user_id_id_fk" FOREIGN KEY ("user_id","asset_id") REFERENCES "public"."diagram_assets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_answers" ADD CONSTRAINT "diagram_answers_user_id_question_id_diagram_questions_user_id_id_fk" FOREIGN KEY ("user_id","question_id") REFERENCES "public"."diagram_questions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_contributions" ADD CONSTRAINT "diagram_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_fixed_income" ADD CONSTRAINT "diagram_fixed_income_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_questions" ADD CONSTRAINT "diagram_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_settings" ADD CONSTRAINT "diagram_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagram_contributions_user_date_idx" ON "diagram_contributions" USING btree ("user_id","date");