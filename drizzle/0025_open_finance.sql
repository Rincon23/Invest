CREATE TABLE "bank_accounts" (
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"balance" numeric,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_user_id_account_id_pk" PRIMARY KEY("user_id","account_id"),
	CONSTRAINT "bank_accounts_kind" CHECK ("bank_accounts"."kind" in ('checking', 'savings', 'card', 'other'))
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_user_id_item_id_pk" PRIMARY KEY("user_id","item_id"),
	CONSTRAINT "bank_connections_status" CHECK ("bank_connections"."status" in ('pending', 'ok', 'error', 'reconnect'))
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
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_item_id_bank_connections_user_id_item_id_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."bank_connections"("user_id","item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_keys" ADD CONSTRAINT "bank_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;