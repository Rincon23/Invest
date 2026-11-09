ALTER TABLE "budget_settings" ADD COLUMN "home_order" jsonb;--> statement-breakpoint
ALTER TABLE "budget_settings" ADD COLUMN "home_card_sizes" jsonb DEFAULT '{}'::jsonb NOT NULL;