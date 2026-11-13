ALTER TABLE "facts" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD COLUMN "effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_superseded_by_facts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facts_superseded_by" ON "facts" USING btree ("superseded_by");