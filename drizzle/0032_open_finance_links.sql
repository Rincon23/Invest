CREATE TABLE "bank_links" (
	"user_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"entry_month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_links_user_id_transaction_id_entry_id_pk" PRIMARY KEY("user_id","transaction_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "bank_links" ADD CONSTRAINT "bank_links_user_id_transaction_id_bank_transactions_user_id_transaction_id_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."bank_transactions"("user_id","transaction_id") ON DELETE cascade ON UPDATE no action;