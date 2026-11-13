import {
  and,
  cosineDistance,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "./db.js";
import {
  facts,
  proposalItems,
  proposals,
  sourceChunks,
  sources,
} from "./db/schema.js";
import { embeddings } from "./models.js";

// 知識庫: sources, facts and the proposals that change them (ADR-0001). The
// knowledge base proper is the confirmed facts; a proposal's facts wait as
// 待確認 until a member confirms it over REST, never through a model
// (ADR-0003). Every call is limited to one workspace.

/** One item of a proposal, as shown on its card. */
export interface ProposalItem {
  id: string;
  kind: "add" | "supersede" | "obsolete";
  /** The fact it adds. */
  factId: string;
  content: string;
  /**
   * The fact's status: 待確認 while the proposal is; once confirmed, an item
   * left unticked is 已拒絕.
   */
  status: FactStatus;
  /** Present when a member edited the fact's text inline. */
  edited?: Edited;
}

export type FactStatus = "pending" | "confirmed" | "rejected" | "expired";

/** A fact a member edited inline on its proposal card. */
export interface Edited {
  /** The member who edited it. */
  by: string;
  /** The text as extracted, before the edit. */
  originalContent: string;
}

/** An item's text as a member edited it on the card, sent with 確認. */
export interface ItemEdit {
  itemId: string;
  content: string;
}

/** A proposal as shown on its card and returned by the proposal routes. */
export interface Proposal {
  id: string;
  status: "pending" | "confirmed" | "rejected";
  createdBy: string;
  createdAt: string;
  items: ProposalItem[];
}

/** A current confirmed fact that matches a query. */
export interface FactMatch {
  id: string;
  content: string;
  validFrom: string;
  /** Cosine similarity of the fact to the query. */
  similarity: number;
  /** Present when a member edited the fact's text inline. */
  edited?: Edited;
  /**
   * What the fact was drawn from: a message as given, or the passage of a
   * file, labelled with its path (e.g. "meeting.txt › 一、運送排放").
   */
  source: { id: string; content: string; createdAt: string; label?: string };
}

/** A passage of a file source, matching a query. */
export interface ChunkMatch {
  id: string;
  /** [filename, H1, H2, H3]; a PDF's [filename, "第 N 頁"], a txt's [filename, its opening]. */
  path: string[];
  content: string;
  /** When its source was given. */
  createdAt: string;
  /** Cosine similarity of the passage to the query. */
  similarity: number;
}

/** A passage of a file source, as 切 chunk made it. */
export interface SourceChunk {
  path: string[];
  content: string;
  /** What is embedded: the path, then the content. */
  embedText: string;
}

/**
 * A fact drawn from an input: its text, and for a file the index (into
 * `chunks`) of the passage it came from.
 */
export type FactDraft = string | { content: string; chunk?: number };

/**
 * Stores the input as a source, with a file's passages, and proposes each
 * fact drawn from it as a 新增 item, embedded but pending; nothing is in the
 * knowledge base yet. A file's passages are answered from only once one of
 * its proposals is confirmed.
 */
export async function propose(
  workspaceId: string,
  userId: string,
  input: {
    source:
      | { kind: "message"; content: string }
      | { kind: "file"; filename: string; content: string };
    chunks?: SourceChunk[];
    facts: FactDraft[];
  },
): Promise<Proposal> {
  const drafts = input.facts.map((fact) =>
    typeof fact === "string" ? { content: fact } : fact,
  );
  const chunks = input.chunks ?? [];
  const model = embeddings();
  const vectors = await model.embedDocuments([
    ...drafts.map((fact) => fact.content),
    ...chunks.map((chunk) => chunk.embedText),
  ]);
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({ workspaceId, createdBy: userId, ...input.source })
      .returning();
    const chunkIds = chunks.length
      ? (
          await tx
            .insert(sourceChunks)
            .values(
              chunks.map((chunk, i) => ({
                workspaceId,
                sourceId: source.id,
                position: i,
                path: chunk.path,
                content: chunk.content,
                embedding: vectors[drafts.length + i],
                embeddingModel: model.model,
              })),
            )
            .returning({ id: sourceChunks.id })
        ).map((row) => row.id)
      : [];
    const added = await tx
      .insert(facts)
      .values(
        drafts.map(({ content, chunk }, i) => ({
          workspaceId,
          sourceId: source.id,
          chunkId: chunk === undefined ? null : chunkIds[chunk],
          content,
          embedding: vectors[i],
          embeddingModel: model.model,
          // Until dates are read from the content (#32), a fact holds from
          // when its source was given.
          validFrom: source.createdAt,
          createdBy: userId,
        })),
      )
      .returning({ id: facts.id, content: facts.content });
    const [proposal] = await tx
      .insert(proposals)
      .values({ workspaceId, sourceId: source.id, createdBy: userId })
      .returning();
    const items = await tx
      .insert(proposalItems)
      .values(
        added.map((fact) => ({
          workspaceId,
          proposalId: proposal.id,
          kind: "add" as const,
          factId: fact.id,
        })),
      )
      .returning({ id: proposalItems.id, factId: proposalItems.factId });
    return {
      id: proposal.id,
      status: proposal.status,
      createdBy: proposal.createdBy,
      createdAt: proposal.createdAt.toISOString(),
      items: items.map((item, i) => ({
        id: item.id,
        kind: "add",
        factId: item.factId!,
        content: added[i].content,
        status: "pending",
      })),
    };
  });
}

/**
 * Why a proposal could not be confirmed or rejected. An edit or an unticked
 * item is invalid when its item is not the proposal's, an edit's text is
 * blank, or every item is unticked (reject the proposal instead).
 */
export type DecisionError = "not found" | "already decided" | "invalid edit";

/**
 * Confirms a pending proposal: its facts enter the knowledge base, recorded
 * now and confirmed by the user, except the items `excluded` (unticked on the
 * card), whose facts are rejected. An edited item's fact takes the edited
 * text, embedded anew, and keeps the extraction and the editor; an edit that
 * leaves the text as it is changes nothing.
 */
export async function confirmProposal(
  workspaceId: string,
  proposalId: string,
  userId: string,
  {
    edits = [],
    excluded = [],
  }: { edits?: ItemEdit[]; excluded?: string[] } = {},
): Promise<Proposal | DecisionError> {
  const texts = edits.map((edit) => edit.content.trim());
  if (texts.some((text) => !text)) return "invalid edit";
  // Embedded before the proposal is locked, so the lock never waits on the
  // embedding model.
  const model = embeddings();
  const vectors = texts.length ? await model.embedDocuments(texts) : [];
  const edited = edits.map((edit, i) => ({
    itemId: edit.itemId,
    content: texts[i],
    embedding: vectors[i],
    embeddingModel: model.model,
  }));
  return decide(workspaceId, proposalId, userId, "confirmed", edited, excluded);
}

/** Rejects a pending proposal: none of its facts enter the knowledge base. */
export function rejectProposal(
  workspaceId: string,
  proposalId: string,
  userId: string,
): Promise<Proposal | DecisionError> {
  return decide(workspaceId, proposalId, userId, "rejected");
}

async function decide(
  workspaceId: string,
  proposalId: string,
  userId: string,
  status: "confirmed" | "rejected",
  edits: {
    itemId: string;
    content: string;
    embedding: number[];
    embeddingModel: string;
  }[] = [],
  excluded: string[] = [],
): Promise<Proposal | DecisionError> {
  if (!isUuid(proposalId)) return "not found";
  return db.transaction(async (tx) => {
    // Locked, so of two members deciding at once only the first does.
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.id, proposalId),
          eq(proposals.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!proposal) return "not found";
    if (proposal.status !== "pending") return "already decided";
    const items = await tx
      .select({
        id: proposalItems.id,
        kind: proposalItems.kind,
        factId: proposalItems.factId,
        content: facts.content,
      })
      .from(proposalItems)
      .innerJoin(facts, eq(facts.id, proposalItems.factId))
      .where(eq(proposalItems.proposalId, proposalId));
    const itemOf = new Map(items.map((item) => [item.id, item]));
    const unticked = new Set(excluded);
    if (
      edits.some((edit) => !itemOf.has(edit.itemId)) ||
      excluded.some((id) => !itemOf.has(id)) ||
      (items.length > 0 && items.every((item) => unticked.has(item.id)))
    )
      return "invalid edit";
    for (const edit of edits) {
      const item = itemOf.get(edit.itemId)!;
      if (edit.content === item.content) continue;
      await tx
        .update(facts)
        .set({
          content: edit.content,
          embedding: edit.embedding,
          embeddingModel: edit.embeddingModel,
          // The first edit's text before it is the extraction.
          originalContent: sql`coalesce(${facts.originalContent}, ${facts.content})`,
          editedBy: userId,
        })
        .where(eq(facts.id, item.factId!));
    }
    const now = new Date();
    const [decided] = await tx
      .update(proposals)
      .set({ status, decidedBy: userId, decidedAt: now })
      .where(eq(proposals.id, proposalId))
      .returning();
    const factIds = (group: { factId: string | null }[]) =>
      inArray(
        facts.id,
        group.map((item) => item.factId!),
      );
    const ticked = items.filter((item) => !unticked.has(item.id));
    const dropped = items.filter((item) => unticked.has(item.id));
    const changed = [];
    for (const [group, set] of [
      [
        ticked,
        status === "confirmed"
          ? { status, recordedAt: now, confirmedBy: userId }
          : { status },
      ],
      [dropped, { status: "rejected" as const }],
    ] as const) {
      if (group.length === 0) continue;
      changed.push(
        ...(await tx
          .update(facts)
          .set(set)
          .where(and(eq(facts.workspaceId, workspaceId), factIds(group)))
          .returning({
            id: facts.id,
            content: facts.content,
            status: facts.status,
            originalContent: facts.originalContent,
            editedBy: facts.editedBy,
          })),
      );
    }
    const factOf = new Map(changed.map((fact) => [fact.id, fact]));
    return {
      id: decided.id,
      status: decided.status,
      createdBy: decided.createdBy,
      createdAt: decided.createdAt.toISOString(),
      items: items.map((item) => {
        const fact = factOf.get(item.factId!);
        return {
          id: item.id,
          kind: item.kind,
          factId: item.factId!,
          content: fact?.content ?? "",
          status: fact?.status ?? "rejected",
          ...editedOf(fact),
        };
      }),
    };
  });
}

/**
 * The current confirmed facts most similar to the query, best first. Facts
 * embedded by another model than EMBEDDING_MODEL can't be compared and are
 * skipped.
 */
export async function searchFacts(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<FactMatch[]> {
  const model = embeddings();
  const vector = await model.embedQuery(query);
  const similarity = sql<number>`1 - (${cosineDistance(facts.embedding, vector)})`;
  const rows = await db
    .select({
      id: facts.id,
      content: facts.content,
      validFrom: facts.validFrom,
      similarity,
      originalContent: facts.originalContent,
      editedBy: facts.editedBy,
      sourceId: sources.id,
      sourceContent: sources.content,
      sourceCreatedAt: sources.createdAt,
      chunkContent: sourceChunks.content,
      chunkPath: sourceChunks.path,
    })
    .from(facts)
    .innerJoin(sources, eq(sources.id, facts.sourceId))
    .leftJoin(sourceChunks, eq(sourceChunks.id, facts.chunkId))
    .where(
      and(
        eq(facts.workspaceId, workspaceId),
        eq(facts.status, "confirmed"),
        isNull(facts.validTo),
        eq(facts.embeddingModel, model.model),
      ),
    )
    .orderBy(cosineDistance(facts.embedding, vector))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    validFrom: row.validFrom.toISOString(),
    similarity: Number(row.similarity),
    ...editedOf(row),
    source: {
      id: row.sourceId,
      content: row.chunkContent ?? row.sourceContent,
      createdAt: row.sourceCreatedAt.toISOString(),
      ...(row.chunkPath && { label: row.chunkPath.join(" › ") }),
    },
  }));
}

// From each of vector and trigram keyword search, and how they are fused
// (reciprocal rank fusion).
const CHUNK_CANDIDATES = 20;
const RRF_K = 60;
const MIN_KEYWORD_SIMILARITY = 0.1;

/**
 * The passages of file sources that best match the query, best first: the
 * embedding cosine and pg_trgm keyword rankings, fused by reciprocal rank.
 * Only passages of a source with a confirmed proposal count, so an
 * unreviewed upload never reaches an answer.
 */
export async function searchChunks(
  workspaceId: string,
  query: string,
  limit: number,
): Promise<ChunkMatch[]> {
  const model = embeddings();
  const vector = await model.embedQuery(query);
  const distance = cosineDistance(sourceChunks.embedding, vector);
  const keyword = sql<number>`word_similarity(${query}, ${sourceChunks.content})`;
  const ranked = (order: SQL, where?: SQL) =>
    db
      .select({
        id: sourceChunks.id,
        path: sourceChunks.path,
        content: sourceChunks.content,
        createdAt: sources.createdAt,
        similarity: sql<number>`1 - (${distance})`,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sources.id, sourceChunks.sourceId))
      .where(
        and(
          eq(sourceChunks.workspaceId, workspaceId),
          eq(sourceChunks.embeddingModel, model.model),
          sql`exists (select 1 from ${proposals} where ${proposals.sourceId} = ${sources.id} and ${proposals.status} = 'confirmed')`,
          where,
        ),
      )
      .orderBy(order)
      .limit(CHUNK_CANDIDATES);
  const rankings = await Promise.all([
    ranked(distance),
    ranked(sql`${keyword} desc`, sql`${keyword} >= ${MIN_KEYWORD_SIMILARITY}`),
  ]);
  const fused = new Map<
    string,
    { row: (typeof rankings)[number][number]; score: number }
  >();
  for (const ranking of rankings)
    ranking.forEach((row, rank) => {
      const entry = fused.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      fused.set(row.id, entry);
    });
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({
      id: row.id,
      path: row.path,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      similarity: Number(row.similarity),
    }));
}

function editedOf(
  fact: { originalContent: string | null; editedBy: string | null } | undefined,
): { edited?: Edited } {
  return fact?.originalContent != null && fact.editedBy != null
    ? { edited: { by: fact.editedBy, originalContent: fact.originalContent } }
    : {};
}

function isUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );
}
