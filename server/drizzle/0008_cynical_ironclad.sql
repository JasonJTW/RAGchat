CREATE TABLE "excluded_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"term" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excluded_terms_term" UNIQUE("workspace_id","term")
);
--> statement-breakpoint
CREATE TABLE "pseudonyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pseudonym" text NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"value_cipher" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pseudonyms_value" UNIQUE("workspace_id","value_hash"),
	CONSTRAINT "pseudonyms_pseudonym" UNIQUE("workspace_id","pseudonym")
);
--> statement-breakpoint
ALTER TABLE "excluded_terms" ADD CONSTRAINT "excluded_terms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pseudonyms" ADD CONSTRAINT "pseudonyms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;