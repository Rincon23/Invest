CREATE TABLE "reserve_contributions" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric NOT NULL,
	"date" date NOT NULL,
	"expense_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_contributions_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "reserve_plans" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"target_amount" numeric NOT NULL,
	"months" integer NOT NULL,
	"start_month" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "reimbursed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reserve_contributions" ADD CONSTRAINT "reserve_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_plans" ADD CONSTRAINT "reserve_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;