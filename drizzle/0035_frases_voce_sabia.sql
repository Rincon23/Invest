CREATE TABLE "investing_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"detail" text NOT NULL,
	"source_label" text NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
