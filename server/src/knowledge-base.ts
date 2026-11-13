import {
  and,
  asc,
  cosineDistance,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./db.js";
import { facts, proposalItems, proposals, sources } from "./db/schema.js";
import { embeddings } from "./models.js";

// 知識庫: sources, facts and the proposals that change them (ADR-0001). The
// knowledge base proper is the current confirmed facts: confirmed, and not
// replaced (取代) or marked 過時, which ends a fact's `valid_to`. A replaced
// fact keeps `superseded_by`, so a fact's history chain can be followed
// back. A proposal's facts wait as 待確認 until a member confirms it over
// REST, never through a model (ADR-0003). Every call is limited to one
// workspace.

/**
 * One item of a proposal, as shown on its card: 新增 adds a fact, 取代 adds
 * one that replaces its target, 過時 ends its target with no replacement.
 */
export interface ProposalItem {
  id: string;
  kind: "add" | "supersede" | "obsolete";
  /** The fact it adds (新增, 取代); absent for 過時. */
  factId?: string;
  /** That fact's text; absent for 過時. */
  content?: string;
  /** Present when a member edited the fact's text inline. */
  edited?: Edited;
  /** The fact it replaces or marks 過時 (取代, 過時). */
  target?: { factId: string; content: string; validFrom: string };
  /** Why the target changes (取代, 過時). */
  reason?: string;
  /** When the change takes effect (取代, 過時): the target's end. */
  effectiveAt?: string;
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
  /** 取代 and 過時 items first, then 新增 ones. */
  items: ProposalItem[];
}

/** A current confirmed fact: in the knowledge base, not replaced or 過時. */
export interface Fact {
  id: string;
  content: string;
  validFrom: string;
}

/** One version in a fact's history chain. */
export interface HistoryEntry {
  factId: string;
  content: string;
  validFrom: string;
  /** When the next version replaced it; null for the current one. */
  validTo: string | null;
  /** Why it replaced the version before it; absent for the first. */
  reason?: string;
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
   * The versions it replaced, oldest first, ending with itself; present
   * only when it replaced one (e.g. 取代率 → 回收率 → 取代率).
   */
  history?: HistoryEntry[];
  /** The source the fact was drawn from, as given. */
  source: { id: string; content: string; createdAt: string };
}

/** A change to a current fact proposed by a correction. */
export type Correction = {
  /** A current confirmed fact of the workspace. */
  targetFactId: string;
  reason: string;
  /** When the change took effect (ISO). */
  effectiveAt: string;
} & ({ kind: "supersede"; content: string } | { kind: "obsolete" });

// A fact in the knowledge base now: confirmed, and not replaced or 過時.
const current = and(eq(facts.status, "confirmed"), isNull(facts.validTo));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Stores the input as a source and proposes its changes: each fact drawn
 * from it as a 新增 item, each correction as a 取代 or 過時 item. New facts
 * are embedded but pending; nothing is in the knowledge base yet. Throws
 * when a correction's target is not a current fact of the workspace.
 */
export async function propose(
  workspaceId: string,
  userId: string,
  input: {
    source: { kind: "message" | "file"; content: string };
    facts: string[];
    corrections?: Correction[];
  },
): Promise<Proposal> {
  const corrections = input.corrections ?? [];
  const added = [
    ...corrections.flatMap((c) =>
      c.kind === "supersede"
        ? [{ content: c.content, validFrom: new Date(c.effectiveAt) }]
        : [],
    ),
    ...input.facts.map((content) => ({ content, validFrom: undefined })),
  ];
  const model = embeddings();
  const vectors = added.length
    ? await model.embedDocuments(added.map((fact) => fact.content))
    : [];
  return db.transaction(async (tx) => {
    const targetIds = corrections.map((c) => c.targetFactId);
    if (
      (await currentFacts(workspaceId, targetIds, tx)).length !==
      new Set(targetIds).size
    )
      throw new Error("a correction's target is not a current fact");
    const [source] = await tx
      .insert(sources)
      .values({ workspaceId, createdBy: userId, ...input.source })
      .returning();
    const factIds = added.length
      ? (
          await tx
            .insert(facts)
            .values(
              added.map((fact, i) => ({
                workspaceId,
                sourceId: source.id,
                content: fact.content,
                embedding: vectors[i],
                embeddingModel: model.model,
                // Until dates are read from the content (#32), a new fact
                // holds from when its source was given; a replacement from
                // when the correction took effect.
                validFrom: fact.validFrom ?? source.createdAt,
                createdBy: userId,
              })),
            )
            .returning({ id: facts.id })
        ).map((fact) => fact.id)
      : [];
    const [proposal] = await tx
      .insert(proposals)
      .values({ workspaceId, sourceId: source.id, createdBy: userId })
      .returning();
    let next = 0;
    const items = [
      ...corrections.map((c) => ({
        workspaceId,
        proposalId: proposal.id,
        kind: c.kind,
        factId: c.kind === "supersede" ? factIds[next++] : null,
        targetFactId: c.targetFactId,
        reason: c.reason,
        effectiveAt: new Date(c.effectiveAt),
      })),
      ...factIds.slice(next).map((factId) => ({
        workspaceId,
        proposalId: proposal.id,
        kind: "add" as const,
        factId,
      })),
    ];
    await tx
      .insert(proposalItems)
      .values(items.map((item, position) => ({ ...item, position })));
    return proposalOf(proposal, await itemsOf(tx, proposal.id));
  });
}

/**
 * Why a proposal could not be confirmed or rejected. An edit is invalid when
 * its item is not the proposal's, adds no fact (過時), or its text is blank.
 * The target changed when a fact the proposal replaces or marks 過時 is no
 * longer current.
 */
export type DecisionError =
  "not found" | "already decided" | "invalid edit" | "target changed";

/**
 * Confirms a pending proposal: its facts enter the knowledge base, recorded
 * now and confirmed by the user, and the facts it replaces or marks 過時
 * leave it as of each item's effective date, kept in history. An edited
 * item's fact takes the edited text, embedded anew, and keeps the extraction
 * and the editor; an edit that leaves the text as it is changes nothing.
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
    const items = await itemsOf(tx, proposalId);
    const itemOf = new Map(items.map((item) => [item.id, item]));
    if (edits.some((edit) => !itemOf.get(edit.itemId)?.factId))
      return "invalid edit";
    const changes = items.filter((item) => item.target);
    if (status === "confirmed" && changes.length) {
      // Locked in id order, so two proposals changing the same facts can't
      // deadlock; the second sees the first's change and is refused.
      const targetIds = changes.map((item) => item.target!.factId).sort();
      const locked = await tx
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(
            eq(facts.workspaceId, workspaceId),
            inArray(facts.id, targetIds),
            current,
          ),
        )
        .orderBy(asc(facts.id))
        .for("update");
      if (locked.length !== new Set(targetIds).size) return "target changed";
    }
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
    await tx
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
      );
    if (status === "confirmed")
      for (const item of changes)
        await tx
          .update(facts)
          .set({
            validTo: new Date(item.effectiveAt!),
            supersededBy: item.factId ?? null,
          })
          .where(eq(facts.id, item.target!.factId));
    return proposalOf(decided, await itemsOf(tx, proposalId));
  });
}

function proposalOf(
  row: typeof proposals.$inferSelect,
  items: ProposalItem[],
): Proposal {
  return {
    id: row.id,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    items,
  };
}

// The proposal's items as its card shows them, 取代 and 過時 first.
async function itemsOf(tx: Tx, proposalId: string): Promise<ProposalItem[]> {
  const target = alias(facts, "target");
  const rows = await tx
    .select({
      id: proposalItems.id,
      kind: proposalItems.kind,
      factId: proposalItems.factId,
      content: facts.content,
      originalContent: facts.originalContent,
      editedBy: facts.editedBy,
      targetFactId: target.id,
      targetContent: target.content,
      targetValidFrom: target.validFrom,
      reason: proposalItems.reason,
      effectiveAt: proposalItems.effectiveAt,
    })
    .from(proposalItems)
    .leftJoin(facts, eq(facts.id, proposalItems.factId))
    .leftJoin(target, eq(target.id, proposalItems.targetFactId))
    .where(eq(proposalItems.proposalId, proposalId))
    .orderBy(asc(proposalItems.position));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    ...(row.factId != null && {
      factId: row.factId,
      content: row.content ?? "",
    }),
    ...editedOf(row),
    ...(row.targetFactId != null && {
      target: {
        factId: row.targetFactId,
        content: row.targetContent ?? "",
        validFrom: (row.targetValidFrom ?? new Date(0)).toISOString(),
      },
    }),
    ...(row.reason != null && { reason: row.reason }),
    ...(row.effectiveAt != null && {
      effectiveAt: row.effectiveAt.toISOString(),
    }),
  }));
}

/**
 * The current confirmed facts most similar to the query, best first, each
 * with its history chain when it replaced another. Facts embedded by another
 * model than EMBEDDING_MODEL can't be compared and are skipped.
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
        current,
        eq(facts.embeddingModel, model.model),
      ),
    )
    .orderBy(cosineDistance(facts.embedding, vector))
    .limit(limit);
  const histories = await historiesOf(
    workspaceId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const history = histories.get(row.id) ?? [];
    return {
      id: row.id,
      content: row.content,
      validFrom: row.validFrom.toISOString(),
      similarity: Number(row.similarity),
      ...editedOf(row),
      ...(history.length > 1 && { history }),
      source: {
        id: row.sourceId,
        content: row.sourceContent,
        createdAt: row.sourceCreatedAt.toISOString(),
      },
    };
  });
}

// How far back a history chain is followed; a guard, never reached in use.
const MAX_HISTORY = 50;

// Each fact's history chain, oldest first, ending with the fact: the facts
// it replaced, followed back through `superseded_by`. A fact replaces at most
// one other (one 取代 item creates it), so each chain is a line.
async function historiesOf(
  workspaceId: string,
  ids: string[],
): Promise<Map<string, HistoryEntry[]>> {
  if (!ids.length) return new Map();
  const { rows } = await db.execute<{
    root: string;
    id: string;
    content: string;
    valid_from: Date;
    valid_to: Date | null;
    reason: string | null;
  }>(sql`
    with recursive chain (root, id, depth) as (
      select id, id, 0 from facts
      where workspace_id = ${workspaceId}
        and id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      union all
      select chain.root, earlier.id, chain.depth + 1
      from chain join facts earlier
        on earlier.superseded_by = chain.id
        and earlier.workspace_id = ${workspaceId}
      where chain.depth < ${MAX_HISTORY}
    )
    select chain.root, facts.id, facts.content, facts.valid_from,
      facts.valid_to, item.reason
    from chain
    join facts on facts.id = chain.id
    left join proposal_items item
      on item.fact_id = facts.id and item.kind = 'supersede'
    order by chain.root, chain.depth desc
  `);
  const histories = new Map<string, HistoryEntry[]>();
  for (const row of rows) {
    const entries = histories.get(row.root) ?? [];
    entries.push({
      factId: row.id,
      content: row.content,
      validFrom: new Date(row.valid_from).toISOString(),
      validTo: row.valid_to && new Date(row.valid_to).toISOString(),
      ...(row.reason != null && { reason: row.reason }),
    });
    histories.set(row.root, entries);
  }
  return histories;
}

/**
 * The facts of the given ids that are current confirmed facts of the
 * workspace, in the order given; other ids, malformed ones included, are
 * skipped.
 */
export async function currentFacts(
  workspaceId: string,
  ids: string[],
  tx: Tx | typeof db = db,
): Promise<Fact[]> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (!valid.length) return [];
  const rows = await tx
    .select({
      id: facts.id,
      content: facts.content,
      validFrom: facts.validFrom,
    })
    .from(facts)
    .where(
      and(
        eq(facts.workspaceId, workspaceId),
        inArray(facts.id, valid),
        current,
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return valid.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ ...row, validFrom: row.validFrom.toISOString() }] : [];
  });
}

/** An item of a pending proposal that replaces or marks 過時 a fact. */
export interface PendingChange {
  targetFactId: string;
  proposalId: string;
  itemId: string;
  kind: "supersede" | "obsolete";
  /** The replacing fact's text (取代). */
  content?: string;
  createdBy: string;
}

/**
 * The items of the workspace's pending proposals that replace or mark 過時
 * any of the given facts, oldest proposal first.
 */
export async function pendingChanges(
  workspaceId: string,
  factIds: string[],
): Promise<PendingChange[]> {
  const ids = [...new Set(factIds.filter(isUuid))];
  if (!ids.length) return [];
  const rows = await db
    .select({
      targetFactId: proposalItems.targetFactId,
      proposalId: proposals.id,
      itemId: proposalItems.id,
      kind: proposalItems.kind,
      content: facts.content,
      createdBy: proposals.createdBy,
    })
    .from(proposalItems)
    .innerJoin(proposals, eq(proposals.id, proposalItems.proposalId))
    .leftJoin(facts, eq(facts.id, proposalItems.factId))
    .where(
      and(
        eq(proposalItems.workspaceId, workspaceId),
        eq(proposals.status, "pending"),
        inArray(proposalItems.targetFactId, ids),
      ),
    )
    .orderBy(asc(proposals.createdAt), asc(proposalItems.position));
  return rows.map((row) => ({
    targetFactId: row.targetFactId!,
    proposalId: row.proposalId,
    itemId: row.itemId,
    kind: row.kind as PendingChange["kind"],
    ...(row.content != null && { content: row.content }),
    createdBy: row.createdBy,
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
