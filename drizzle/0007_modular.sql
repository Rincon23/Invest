ALTER TABLE "budget_settings" ADD COLUMN "nav" jsonb;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD COLUMN "dismissed_notices" jsonb DEFAULT '[]'::jsonb NOT NULL;