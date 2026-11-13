import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// The knowledge base's tables. Every table but this one carries a
// `workspace_id`, so one workspace never sees another's rows (see GLOSSARY.md).
// Change a table here, then `npm run db:generate -w server` writes the
// migration under server/drizzle/.

/** The length of every stored embedding (EMBEDDING_MODEL's output). */
export const EMBEDDING_DIMENSIONS = 1536;

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

const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const sourceKind = pgEnum("source_kind", ["message", "file"]);

/** 來源: one input as it was given; never changed after it is stored. */
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  kind: sourceKind("kind").notNull(),
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 待確認 facts are the items of pending proposals; only 已確認 facts are in
 * the knowledge base. 已拒絕 and 已過期 ones are kept, never answered from.
 */
export const factStatus = pgEnum("fact_status", [
  "pending",
  "confirmed",
  "rejected",
  "expired",
]);

/** 事實: one claim about one 實體, drawn from a source. */
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    status: factStatus("status").notNull().default("pending"),
    /** When the claim became true in the world. */
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    /** When it stopped being true; null while it is current. */
    validTo: timestamp("valid_to", { withTimezone: true }),
    /** When the knowledge base took it in, i.e. when it was confirmed. */
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    confirmedBy: text("confirmed_by"),
    /**
     * The text as extracted, kept when a member edited it inline on the
     * proposal card; null while `content` is the extraction.
     */
    originalContent: text("original_content"),
    /** Who edited it inline; null while unedited. */
    editedBy: text("edited_by"),
  },
  (t) => [
    index("facts_workspace_status").on(t.workspaceId, t.status),
    index("facts_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "confirmed",
  "rejected",
]);

/** 提案: changes to the knowledge base that wait for a member to confirm them. */
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  status: proposalStatus("status").notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const proposalItemKind = pgEnum("proposal_item_kind", [
  "add",
  "supersede",
  "obsolete",
]);

/** One 新增, 取代 or 過時 item of a proposal. */
export const proposalItems = pgTable("proposal_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  kind: proposalItemKind("kind").notNull(),
  /** The pending fact the item adds (新增, 取代). */
  factId: uuid("fact_id").references(() => facts.id, { onDelete: "cascade" }),
  /** The fact it supersedes or marks obsolete (取代, 過時). */
  targetFactId: uuid("target_fact_id").references(() => facts.id, {
    onDelete: "cascade",
  }),
});

/**
 * 對話: one 成員's chat thread in one workspace, saved as the UI messages the
 * chat shows (text, citations, proposal cards). Only its owner may read or
 * continue it. `id` is the chat id the web picks.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceId(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    messages: jsonb("messages").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversations_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.updatedAt,
    ),
  ],
);
