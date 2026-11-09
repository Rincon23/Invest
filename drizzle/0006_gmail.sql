CREATE TABLE "gmail_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"last_history_id" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_accounts_status" CHECK ("gmail_accounts"."status" in ('ok', 'error', 'reconnect'))
);
--> statement-breakpoint
CREATE TABLE "gmail_alerts" (
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"subject" text NOT NULL,
	"from" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_alerts_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_keywords" (
	"user_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"keyword" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_keywords_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_alerts" ADD CONSTRAINT "gmail_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_keywords" ADD CONSTRAINT "gmail_keywords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_alerts_user_received_idx" ON "gmail_alerts" USING btree ("user_id","received_at");