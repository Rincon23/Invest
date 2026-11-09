CREATE TABLE "card_bill_deliveries" (
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"month" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_bill_deliveries_user_id_card_id_month_slot_at_pk" PRIMARY KEY("user_id","card_id","month","slot_at")
);
--> statement-breakpoint
CREATE TABLE "card_bill_payments" (
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_bill_payments_user_id_card_id_month_pk" PRIMARY KEY("user_id","card_id","month"),
	CONSTRAINT "card_bill_payments_month_format" CHECK ("card_bill_payments"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "card_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notify_time" text DEFAULT '09:00' NOT NULL,
	"repeat_until_paid" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"due_day" integer NOT NULL,
	"due_month" text DEFAULT 'next' NOT NULL,
	"notify_enabled" boolean DEFAULT true NOT NULL,
	"notify_before_days" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"color" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "cards_due_day" CHECK ("cards"."due_day" between 1 and 31),
	CONSTRAINT "cards_due_month" CHECK ("cards"."due_month" in ('same', 'next')),
	CONSTRAINT "cards_notify_before_days" CHECK ("cards"."notify_before_days" between 0 and 30)
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "card_bill_deliveries" ADD CONSTRAINT "card_bill_deliveries_user_id_card_id_cards_user_id_id_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."cards"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_user_id_card_id_cards_user_id_id_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."cards"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settings" ADD CONSTRAINT "card_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_bill_deliveries_slot_at_idx" ON "card_bill_deliveries" USING btree ("slot_at");--> statement-breakpoint
CREATE INDEX "expenses_user_card_idx" ON "expenses" USING btree ("user_id","card_id");