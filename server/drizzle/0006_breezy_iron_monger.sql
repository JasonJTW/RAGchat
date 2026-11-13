ALTER TYPE "public"."proposal_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "expired_by" uuid;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_expired_by_proposals_id_fk" FOREIGN KEY ("expired_by") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;