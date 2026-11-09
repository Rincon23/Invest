CREATE TABLE "bank_investments" (
	"user_id" uuid NOT NULL,
	"investment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"subtype" text,
	"balance" numeric,
	"balance_at" timestamp with time zone,
	"feeds_reserve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_investments_user_id_investment_id_pk" PRIMARY KEY("user_id","investment_id")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "feeds_reserve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD CONSTRAINT "bank_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD CONSTRAINT "bank_investments_user_id_item_id_bank_connections_user_id_item_id_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."bank_connections"("user_id","item_id") ON DELETE cascade ON UPDATE no action;