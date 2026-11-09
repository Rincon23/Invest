ALTER TABLE "budget_settings" ADD COLUMN "home_hidden" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD COLUMN "quick_categories" jsonb;