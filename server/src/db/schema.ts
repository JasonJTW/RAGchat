import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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

/**
 * 實體: what facts speak of, e.g. a person, a feature, an algorithm. One
 * thing has one entity in a workspace; its other names are its aliases. It
 * lives while a pending or confirmed fact is linked to it, and is new (shown
 * as such on a proposal card) until a confirmed one is.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    /** person, project, feature, method, module, organization, document, other. */
    kind: text("kind").notNull(),
    /** The name's embedding, for finding the entity a new mention means. */
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entities_workspace").on(t.workspaceId),
    index("entities_embedding").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/** 別名: another name of an entity, e.g. 「減碳計算模型」 for 避免排放算法. */
export const entityAliases = pgTable(
  "entity_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    /**
     * The fact whose mention gave the alias: the alias lives while that fact
     * is pending or confirmed.
     */
    factId: uuid("fact_id")
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("entity_aliases_entity").on(t.entityId),
    index("entity_aliases_embedding").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/** The entities a fact speaks of. */
export const factEntities = pgTable(
  "fact_entities",
  {
    workspaceId: workspaceId(),
    factId: uuid("fact_id")
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.factId, t.entityId] }),
    index("fact_entities_entity").on(t.entityId),
  ],
);

/**
 * A relation between two entities that a fact states, e.g. 小林 負責
 * 避免排放算法. It holds while its fact does: its validity is the fact's
 * (`valid_from`, `valid_to`, status), never a copy.
 */
export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    fromEntityId: uuid("from_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    toEntityId: uuid("to_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    factId: uuid("fact_id")
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("edges_from").on(t.fromEntityId),
    index("edges_to").on(t.toEntityId),
    index("edges_fact").on(t.factId),
  ],
);

/**
 * 代稱 (ADR-0004): one sensitive value and the pseudonym that stands for it
 * everywhere in the workspace's knowledge base (〔人名3〕). The value is only
 * here, AES-256-GCM encrypted with PSEUDONYM_ENCRYPTION_KEY; `value_hash` (an
 * HMAC under the same key) finds the row for a value without decrypting.
 * A 成員 marking a term 敏感 adds a row too. See pseudonyms.ts.
 */
export const pseudonyms = pgTable(
  "pseudonyms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    /** e.g. 〔人名3〕: the kind, then a number counted per kind. */
    pseudonym: text("pseudonym").notNull(),
    /** What the value is: 人名, 組織, 電話, 信箱, 身分證, 統編, 地址, 金額, 卡號, 敏感詞. */
    kind: text("kind").notNull(),
    valueHash: text("value_hash").notNull(),
    /** base64 of IV (12 bytes) | tag (16 bytes) | ciphertext. */
    valueCipher: text("value_cipher").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("pseudonyms_value").on(t.workspaceId, t.valueHash),
    unique("pseudonyms_pseudonym").on(t.workspaceId, t.pseudonym),
  ],
);

/**
 * 排除詞: terms a 成員 marked as not sensitive, never pseudonymised in later
 * input. Stored as typed, since they are by definition not sensitive.
 */
export const excludedTerms = pgTable(
  "excluded_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: workspaceId(),
    term: text("term").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("excluded_terms_term").on(t.workspaceId, t.term)],
);

/**
 * 刪除紀錄: that a 來源 was hard-deleted, by whom and when. Its id is all it
 * keeps of the source: no content, filename or anything drawn from it.
 */
export const deletions = pgTable("deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: workspaceId(),
  /** The deleted source's id; it no longer refers to a row. */
  sourceId: uuid("source_id").notNull(),
  deletedBy: text("deleted_by").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
