CREATE TABLE "bank_transactions" (
	"user_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text,
	"description" text NOT NULL,
	"description_raw" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"category" text,
	"operation_type" text,
	"payment_method" text,
	"payer_name" text,
	"payer_document" text,
	"receiver_name" text,
	"receiver_document" text,
	"merchant_name" text,
	"installment_number" integer,
	"total_installments" integer,
	"purchase_date" date,
	"bill_id" text,
	"outcome" text,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_user_id_transaction_id_pk" PRIMARY KEY("user_id","transaction_id")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "balance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "credit_limit" numeric;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "available_credit" numeric;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "synced_update_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_user_id_account_id_bank_accounts_user_id_account_id_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_accounts"("user_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_transactions_user_date_idx" ON "bank_transactions" USING btree ("user_id","date");