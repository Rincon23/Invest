ALTER TABLE "diagram_assets" DROP CONSTRAINT "diagram_assets_type";--> statement-breakpoint
ALTER TABLE "diagram_fixed_income" ADD COLUMN "score" numeric DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "diagram_assets" ADD CONSTRAINT "diagram_assets_type" CHECK ("diagram_assets"."type" in ('brStocks', 'intlStocks', 'fiis', 'reits', 'crypto', 'fixedIncome', 'intlFixedIncome'));--> statement-breakpoint
ALTER TABLE "diagram_fixed_income" ADD CONSTRAINT "diagram_fixed_income_score" CHECK ("diagram_fixed_income"."score" between -1 and 1);