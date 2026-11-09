CREATE TABLE "job_runs" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_completions" (
	"user_id" uuid NOT NULL,
	"reminder_id" text NOT NULL,
	"due_date" date NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_completions_user_id_reminder_id_due_date_pk" PRIMARY KEY("user_id","reminder_id","due_date")
);
--> statement-breakpoint
CREATE TABLE "reminder_deliveries" (
	"user_id" uuid NOT NULL,
	"reminder_id" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_deliveries_user_id_reminder_id_slot_at_pk" PRIMARY KEY("user_id","reminder_id","slot_at")
);
--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"repeat_enabled" boolean DEFAULT true NOT NULL,
	"repeat_times" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"date" date,
	"time" text,
	"times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"day_of_month" integer,
	"notify_before_minutes" integer,
	"repeat" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "reminders_kind" CHECK ("reminders"."kind" in ('once', 'daily', 'weekly', 'monthly'))
);
--> statement-breakpoint
ALTER TABLE "reminder_completions" ADD CONSTRAINT "reminder_completions_user_id_reminder_id_reminders_user_id_id_fk" FOREIGN KEY ("user_id","reminder_id") REFERENCES "public"."reminders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_user_id_reminder_id_reminders_user_id_id_fk" FOREIGN KEY ("user_id","reminder_id") REFERENCES "public"."reminders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_deliveries_slot_at_idx" ON "reminder_deliveries" USING btree ("slot_at");