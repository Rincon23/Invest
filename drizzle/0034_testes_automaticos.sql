CREATE TABLE "self_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"results" jsonb NOT NULL,
	"failed" integer NOT NULL,
	"warned" integer NOT NULL,
	CONSTRAINT "self_test_runs_trigger" CHECK ("self_test_runs"."trigger" in ('start', 'schedule', 'manual'))
);
--> statement-breakpoint
CREATE INDEX "self_test_runs_started_idx" ON "self_test_runs" USING btree ("started_at");