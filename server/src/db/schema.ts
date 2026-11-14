import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// The knowledge base's tables. Every table but this one and guest_usage carries a
// `workspace_id`, so one workspace never sees another's rows (see GLOSSARY.md).
// Change a table here, then `npm run db:generate -w server` writes the
// migration under server/drizzle/.

/** The length of every stored embedding (EMBEDDING_MODEL's output). */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * `demo` is the template every 試用工作區 is copied from: the 示範資料, built
 * once per embedding model (see demo-seed.ts). Nobody works in it.
 */
export const workspaceKind = pgEnum("workspace_kind", [
  "team",
  "guest",
  "demo",
]);

/** 工作區: the team's one workspace, or a guest's trial workspace. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: workspaceKind("kind").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** The 訪客 whose 試用工作區 it is; null for the team and the template. */
  ownerId: text("owner_id").unique(),
  /** A trial's last request; idle for 7 days, it is deleted. */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  /** Until when the trial's 訪客 counts as human (Turnstile). */
  verifiedUntil: timestamp("verified_until", { withTimezone: true }),
});

/**
 * What a 訪客 used on one day (Asia/Taipei): messages and uploaded files.
 * The row with `user_id = '*'` counts every 訪客 together.
 */
export const guestUsage = pgTable(
  "guest_usage",
  {
    userId: text("user_id").notNull(),
    day: date("day").notNull(),
    messages: integer("messages").notNull().default(0),
    uploads: integer("uploads").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

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
  /** A file's name as uploaded; null for a chat message. */
  filename: text("filename"),
  /** The message, or the file's text (a PDF's pages separated by \f). */
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A file source's passages (依標題切、800 tokens), embedded and trigram
 * indexed. Answers draw on them once a proposal of the source is confirmed.
 */
export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Its place in the source, from 0. */
    position: integer("position").notNull(),
    /** [filename, H1, H2, H3]; a PDF's [filename, "第 N 頁"], a txt's [filename, its opening]. */
    path: text("path").array().notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
  },
  (t) => [
    index("source_chunks_source").on(t.sourceId, t.position),
    index("source_chunks_embedding").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("source_chunks_content_trgm").using(
      "gin",
      t.content.op("gin_trgm_ops"),
    ),
  ],
);

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
    /** The passage of a file source it was drawn from; null for a message. */
    chunkId: uuid("chunk_id").references(() => sourceChunks.id, {
      onDelete: "cascade",
    }),
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
    /**
     * The fact that replaced it (取代); null while current or when it was
     * marked 過時 without a replacement. Following it backwards from a
     * current fact gives that fact's history chain.
     */
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => facts.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    index("facts_workspace_status").on(t.workspaceId, t.status),
    index("facts_superseded_by").on(t.supersededBy),
    index("facts_embedding").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** A proposal is 已過期 once every item of it expired. */
export const proposalStatus = pgEnum("proposal_status", [
  "pending",
  "confirmed",
  "rejected",
  "expired",
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
  /** The item's place on the card, from 0. */
  position: integer("position").notNull().default(0),
  /** The pending fact the item adds (新增, 取代). */
  factId: uuid("fact_id").references(() => facts.id, { onDelete: "cascade" }),
  /** The fact it supersedes or marks obsolete (取代, 過時). */
  targetFactId: uuid("target_fact_id").references(() => facts.id, {
    onDelete: "cascade",
  }),
  /** Why the target changes, as the member said it (取代, 過時). */
  reason: text("reason"),
  /**
   * When the change took effect (取代, 過時): the target's `valid_to` and the
   * replacement's `valid_from` once confirmed.
   */
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  /** Left unticked when the proposal was confirmed: it took no effect. */
  excluded: boolean("excluded").notNull().default(false),
  /**
   * The newer proposal whose confirmation expired this pending item, as
   * making the same claim (已過期); null while it can still be confirmed.
   */
  expiredBy: uuid("expired_by").references((): AnyPgColumn => proposals.id, {
    onDelete: "set null",
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
