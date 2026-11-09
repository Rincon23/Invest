ALTER TABLE "budget_settings" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD COLUMN "tag_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;