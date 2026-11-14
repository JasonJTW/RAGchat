CREATE INDEX "facts_content_trgm" ON "facts" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "facts_validity" ON "facts" USING btree ("workspace_id","valid_from","valid_to");