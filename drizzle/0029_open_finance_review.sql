CREATE TABLE "bank_category_memory" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category_kind" text NOT NULL,
	"topic_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_category_memory_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "entry_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "capital_card_id" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "card_linked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "entry_month" text;--> statement-breakpoint
ALTER TABLE "bank_category_memory" ADD CONSTRAINT "bank_category_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;