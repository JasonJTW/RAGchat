import { and, cosineDistance, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db.js";
import { facts, proposalItems, proposals, sources } from "./db/schema.js";
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
  /** Present when a member edited the fact's text inline. */
  edited?: Edited;
}

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
  /** The source the fact was drawn from, as given. */
  source: { id: string; content: string; createdAt: string };
}

/**
 * Stores the input as a source and proposes each fact drawn from it as a
 * 新增 item, embedded but pending; nothing is in the knowledge base yet.
 */
export async function propose(
  workspaceId: string,
  userId: string,
  input: {
    source: { kind: "message" | "file"; content: string };
    facts: string[];
  },
): Promise<Proposal> {
  const model = embeddings();
  const vectors = await model.embedDocuments(input.facts);
  return db.transaction(async (tx) => {
    const [source] = await tx
      .insert(sources)
      .values({ workspaceId, createdBy: userId, ...input.source })
      .returning();
    const added = await tx
      .insert(facts)
      .values(
        input.facts.map((content, i) => ({
          workspaceId,
          sourceId: source.id,
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
      })),
    };
  });
}

/**
 * Why a proposal could not be confirmed or rejected. An edit is invalid when
 * its item is not the proposal's or its text is blank.
 */
export type DecisionError = "not found" | "already decided" | "invalid edit";

/**
 * Confirms a pending proposal: its facts enter the knowledge base, recorded
 * now and confirmed by the user. An edited item's fact takes the edited text,
 * embedded anew, and keeps the extraction and the editor; an edit that
 * leaves the text as it is changes nothing.
 */
export async function confirmProposal(
  workspaceId: string,
  proposalId: string,
  userId: string,
  edits: ItemEdit[] = [],
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
  return decide(workspaceId, proposalId, userId, "confirmed", edited);
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
    if (edits.some((edit) => !itemOf.has(edit.itemId))) return "invalid edit";
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
    const changed = await tx
      .update(facts)
      .set(
        status === "confirmed"
          ? { status, recordedAt: now, confirmedBy: userId }
          : { status },
      )
      .where(
        and(
          eq(facts.workspaceId, workspaceId),
          sql`${facts.id} in (select ${proposalItems.factId} from ${proposalItems} where ${proposalItems.proposalId} = ${proposalId})`,
        ),
      )
      .returning({
        id: facts.id,
        content: facts.content,
        originalContent: facts.originalContent,
        editedBy: facts.editedBy,
      });
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
    })
    .from(facts)
    .innerJoin(sources, eq(sources.id, facts.sourceId))
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
      content: row.sourceContent,
      createdAt: row.sourceCreatedAt.toISOString(),
    },
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
