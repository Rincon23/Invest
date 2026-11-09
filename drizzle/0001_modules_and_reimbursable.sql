ALTER TABLE "expenses" DROP CONSTRAINT "expenses_category_kind";--> statement-breakpoint
ALTER TABLE "budget_settings" ADD COLUMN "modules" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_kind" CHECK ("expenses"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable'));