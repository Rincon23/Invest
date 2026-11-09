ALTER TABLE "card_bill_payments" DROP CONSTRAINT "card_bill_payments_user_id_card_id_cards_user_id_id_fk";
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "limit" numeric;--> statement-breakpoint
ALTER TABLE "installments" ADD COLUMN "purchase_date" date;--> statement-breakpoint
ALTER TABLE "card_bill_payments" ADD CONSTRAINT "card_bill_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;