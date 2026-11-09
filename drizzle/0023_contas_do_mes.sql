CREATE TABLE "recurring_deliveries" (
	"user_id" uuid NOT NULL,
	"recurring_id" text NOT NULL,
	"month" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_deliveries_user_id_recurring_id_month_slot_at_pk" PRIMARY KEY("user_id","recurring_id","month","slot_at")
);
--> statement-breakpoint
CREATE TABLE "recurring_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"notify_enabled" boolean DEFAULT true NOT NULL,
	"notify_time" text DEFAULT '09:00' NOT NULL,
	"repeat_until_launched" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_id" text;--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "recurring_id" text;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "due_day" integer;--> statement-breakpoint
ALTER TABLE "recurring_deliveries" ADD CONSTRAINT "recurring_deliveries_user_id_recurring_id_recurring_expenses_user_id_id_fk" FOREIGN KEY ("user_id","recurring_id") REFERENCES "public"."recurring_expenses"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_settings" ADD CONSTRAINT "recurring_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_user_recurring_idx" ON "expenses" USING btree ("user_id","recurring_id");--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_due_day" CHECK ("recurring_expenses"."due_day" is null or ("recurring_expenses"."due_day" >= 1 and "recurring_expenses"."due_day" <= 31));