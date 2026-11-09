CREATE TABLE "xp_events" (
	"user_id" uuid NOT NULL,
	"mission" text NOT NULL,
	"period" text NOT NULL,
	"xp" integer NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_events_user_id_mission_period_pk" PRIMARY KEY("user_id","mission","period"),
	CONSTRAINT "xp_events_xp_positive" CHECK ("xp_events"."xp" > 0)
);
--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;