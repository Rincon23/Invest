CREATE TABLE "module_access" (
	"module_key" text PRIMARY KEY NOT NULL,
	"vip_only" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
