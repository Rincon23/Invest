ALTER TABLE "expenses" DROP CONSTRAINT "expenses_category_kind";--> statement-breakpoint
ALTER TABLE "installments" DROP CONSTRAINT "installments_category_kind";--> statement-breakpoint
ALTER TABLE "recurring_expenses" DROP CONSTRAINT "recurring_expenses_category_kind";--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "paid_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "advanced_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_kind" CHECK ("expenses"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable', 'uncounted'));--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_paid_count" CHECK ("installments"."paid_count" >= 0 and "installments"."paid_count" <= "installments"."count");--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_advanced_count" CHECK ("installments"."advanced_count" >= 0 and "installments"."paid_count" + "installments"."advanced_count" <= "installments"."count");--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_category_kind" CHECK ("installments"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable', 'uncounted'));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_kind" CHECK ("recurring_expenses"."category_kind" in ('topic', 'fixedCost', 'unforeseen', 'reimbursable', 'uncounted'));