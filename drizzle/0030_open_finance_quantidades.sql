ALTER TABLE "bank_investments" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD COLUMN "isin" text;--> statement-breakpoint
ALTER TABLE "bank_investments" ADD COLUMN "quantity" numeric(24, 8);--> statement-breakpoint
-- Each bank already read is read once more on the next hourly sync (as if it had sent new data), so the quantities arrive without waiting for the bank's next update.
UPDATE "bank_connections" SET "synced_update_at" = "synced_update_at" - interval '1 second' WHERE "synced_update_at" IS NOT NULL;
