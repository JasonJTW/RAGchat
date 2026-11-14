ALTER TYPE "public"."workspace_kind" ADD VALUE 'demo';--> statement-breakpoint
CREATE TABLE "guest_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"uploads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "verified_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_unique" UNIQUE("owner_id");