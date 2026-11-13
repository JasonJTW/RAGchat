import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// The knowledge base's tables. Every table but this one carries a
// `workspace_id`, so one workspace never sees another's rows (see GLOSSARY.md).
// Change a table here, then `npm run db:generate -w server` writes the
// migration under server/drizzle/.

export const workspaceKind = pgEnum("workspace_kind", ["team", "guest"]);

/** 工作區: the team's one workspace, or a guest's trial workspace. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: workspaceKind("kind").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
