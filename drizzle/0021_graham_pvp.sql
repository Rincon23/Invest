CREATE TABLE "fundamentals_cache" (
	"ticker" text PRIMARY KEY NOT NULL,
	"lpa" numeric,
	"vpa" numeric,
	"pvp" numeric,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagram_questions" ADD COLUMN "auto" text;--> statement-breakpoint
ALTER TABLE "diagram_questions" ADD CONSTRAINT "diagram_questions_auto" CHECK ("diagram_questions"."auto" is null or "diagram_questions"."auto" in ('graham', 'pvp'));