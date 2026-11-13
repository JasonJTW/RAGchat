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
  /** The newer proposal whose confirmation expired it (已過期). */
  expiredBy?: string;
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
  /** 已過期 (expired) once a newer proposal's confirmation expired every item. */
  status: "pending" | "confirmed" | "rejected" | "expired";
  createdBy: string;
  createdAt: string;
  /** The member who confirmed or rejected it; absent while pending. */
  decidedBy?: string;
  /** 取代 and 過時 items first, then 新增 ones. */
  items: ProposalItem[];
  /**
   * While pending: the pending items of older proposals that confirming it
   * would expire, as they make the same claim as one of its items.
   */
  expires?: ExpiringItem[];
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
  /** The member whose input proposed it. */
  createdBy: string;
  /** The member who confirmed its proposal. */
  confirmedBy: string;
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
    return cardOf(tx, workspaceId, proposal);
  });
}

/**
 * Why a proposal could not be confirmed or rejected. An edit is invalid when
 * its item is not the proposal's, adds no fact (過時), or its text is blank.
 * The target changed when a fact the proposal replaces or marks 過時 is no
 * longer current, and no change since explains it.
 */
export type DecisionError =
  "not found" | "already decided" | "invalid edit" | "target changed";

/**
 * A change confirmed since the proposal was made that touches one of its
 * items: it changed the item's target, or makes a claim about the same
 * thing. The member judges it before the proposal can be confirmed.
 */
export interface Conflict {
  /** The proposal's item it touches. */
  itemId: string;
  /** The confirmed item that made the change. */
  changeId: string;
  kind: "add" | "supersede" | "obsolete";
  /** The fact it replaced or marked 過時 (取代, 過時). */
  before?: string;
  /** The fact it added (新增, 取代). */
  after?: string;
  decidedBy: string;
  decidedAt: string;
}

/** Confirming stopped: the knowledge base changed since; nothing was written. */
export interface Stopped {
  conflicts: Conflict[];
}

/** A pending item of an older proposal that confirming this one expires. */
export interface ExpiringItem {
  proposalId: string;
  itemId: string;
  kind: "add" | "supersede" | "obsolete";
  /** Its fact, or for 過時 the fact it would end. */
  content: string;
  createdBy: string;
}

/**
 * How alike (cosine) two facts are when they speak of the same thing: a
 * change this alike made since a proposal stops its confirmation.
 */
export const RELATED_AT = 0.75;
/**
 * How alike two facts are when they make the same claim: confirming one
 * expires the pending items of older proposals this alike.
 */
export const SAME_CLAIM_AT = 0.9;

/**
 * Confirms a pending proposal: its facts enter the knowledge base, recorded
 * now and confirmed by the user, and the facts it replaces or marks 過時
 * leave it as of each item's effective date, kept in history. An edited
 * item's fact takes the edited text, embedded anew, and keeps the extraction
 * and the editor; an edit that leaves the text as it is changes nothing.
 *
 * It is re-checked, edits applied, against the changes confirmed since it
 * was made: unless the member acknowledged each of them (`acknowledged`,
 * their change ids), it is stopped with the conflicts and nothing is
 * written. Confirmed anyway, a change to a target replaced since applies to
 * the fact now in its place. Confirming expires the pending items of older
 * proposals that make the same claim as one of its items, or change the
 * same fact (see `Proposal.expires`). Confirmations of a workspace run one
 * at a time, so of two rival proposals confirmed at once only one goes
 * through.
 */
export async function confirmProposal(
  workspaceId: string,
  proposalId: string,
  userId: string,
  edits: ItemEdit[] = [],
  acknowledged: string[] = [],
): Promise<Proposal | DecisionError | Stopped> {
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
  return decide(workspaceId, proposalId, userId, "confirmed", {
    edits: edited,
    acknowledged,
  });
}

/** Rejects a pending proposal: none of its facts enter the knowledge base. */
export async function rejectProposal(
  workspaceId: string,
  proposalId: string,
  userId: string,
): Promise<Proposal | DecisionError> {
  return (await decide(workspaceId, proposalId, userId, "rejected")) as
    Proposal | DecisionError;
}

// Thrown to roll the confirmation (and its edits) back when it is stopped.
class StoppedError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super("stopped");
  }
}

async function decide(
  workspaceId: string,
  proposalId: string,
  userId: string,
  status: "confirmed" | "rejected",
  {
    edits = [],
    acknowledged = [],
  }: {
    edits?: {
      itemId: string;
      content: string;
      embedding: number[];
      embeddingModel: string;
    }[];
    acknowledged?: string[];
  } = {},
): Promise<Proposal | DecisionError | Stopped> {
  if (!isUuid(proposalId)) return "not found";
  try {
    return await db.transaction(async (tx) => {
      // One decision at a time per workspace: each sees the changes the one
      // before it made, so rival proposals can't both be confirmed.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('decide'), hashtext(${workspaceId}))`,
      );
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
      const all = await itemsOf(tx, proposalId);
      const items = all.filter((item) => !item.expiredBy);
      const itemOf = new Map(items.map((item) => [item.id, item]));
      if (edits.some((edit) => !itemOf.get(edit.itemId)?.factId))
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
      const changes = items.filter((item) => item.target);
      if (status === "confirmed") {
        // Re-checked after the edits, so the edited texts are compared.
        const conflicts = await conflictsOf(tx, workspaceId, proposal);
        const seen = new Set(acknowledged);
        if (conflicts.some((c) => !seen.has(c.changeId)))
          throw new StoppedError(conflicts);
        for (const item of changes) {
          const applied = await applyChange(tx, workspaceId, item);
          if (!applied && !conflicts.some((c) => c.itemId === item.id))
            return "target changed";
        }
        await expireOlder(tx, workspaceId, proposal, now);
      }
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
            sql`${facts.id} in (select ${proposalItems.factId} from ${proposalItems} where ${proposalItems.proposalId} = ${proposalId} and ${proposalItems.expiredBy} is null)`,
          ),
        );
      return cardOf(tx, workspaceId, decided);
    });
  } catch (error) {
    if (error instanceof StoppedError) return { conflicts: error.conflicts };
    throw error;
  }
}

/**
 * Ends the item's target as of its effective date (取代, 過時). When the
 * target was replaced since, the change applies to the fact now in its
 * place, and the item is re-pointed at it. False when no current fact
 * stands in the target's place (it was marked 過時): a 取代's new fact then
 * simply follows it.
 */
async function applyChange(
  tx: Tx,
  workspaceId: string,
  item: ProposalItem,
): Promise<boolean> {
  const target = await headOf(tx, workspaceId, item.target!.factId);
  if (!target) {
    if (item.factId)
      await tx
        .update(facts)
        .set({ supersededBy: item.factId })
        .where(
          and(eq(facts.id, item.target!.factId), isNull(facts.supersededBy)),
        );
    return false;
  }
  // Never before the fact it ends began to hold.
  const effectiveAt = new Date(
    Math.max(Date.parse(item.effectiveAt!), target.validFrom.getTime()),
  );
  await tx
    .update(facts)
    .set({ validTo: effectiveAt, supersededBy: item.factId ?? null })
    .where(eq(facts.id, target.id));
  if (
    target.id !== item.target!.factId ||
    +effectiveAt !== Date.parse(item.effectiveAt!)
  ) {
    await tx
      .update(proposalItems)
      .set({ targetFactId: target.id, effectiveAt })
      .where(eq(proposalItems.id, item.id));
    if (item.factId)
      await tx
        .update(facts)
        .set({ validFrom: effectiveAt })
        .where(eq(facts.id, item.factId));
  }
  return true;
}

// The current fact standing in this one's place: itself while current, else
// the end of the chain of facts that replaced it; null when that chain ends
// in a fact marked 過時.
async function headOf(
  tx: Tx,
  workspaceId: string,
  factId: string,
): Promise<{ id: string; validFrom: Date } | null> {
  let id: string | null = factId;
  for (let hops = 0; id && hops <= MAX_HISTORY; hops++) {
    const [fact] = await tx
      .select({
        id: facts.id,
        status: facts.status,
        validTo: facts.validTo,
        validFrom: facts.validFrom,
        supersededBy: facts.supersededBy,
      })
      .from(facts)
      .where(and(eq(facts.id, id), eq(facts.workspaceId, workspaceId)));
    if (!fact) return null;
    if (fact.status === "confirmed" && !fact.validTo) return fact;
    id = fact.supersededBy;
  }
  return null;
}

interface Related {
  mineId: string;
  id: string;
  kind: "add" | "supersede" | "obsolete";
  proposalId: string;
  factContent: string | null;
  targetContent: string | null;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
}

// The items of other proposals (narrowed by `which`) that touch one of the
// proposal's own live items: they change the same fact, or a fact of one is
// at least `at` alike (cosine) to a fact of the other, the new fact and the
// target both counting. Expired items on either side never count.
async function relatedItems(
  tx: Tx,
  workspaceId: string,
  proposal: typeof proposals.$inferSelect,
  which: "confirmed since" | "older pending",
  at: number,
): Promise<Related[]> {
  const filter =
    which === "confirmed since"
      ? sql`p.status = 'confirmed' and p.decided_at > ${proposal.createdAt}`
      : sql`p.status = 'pending' and p.created_at < ${proposal.createdAt}`;
  const { rows } = await tx.execute<{
    mine_id: string;
    id: string;
    kind: Related["kind"];
    proposal_id: string;
    fact_content: string | null;
    target_content: string | null;
    created_by: string;
    decided_by: string | null;
    decided_at: Date | string | null;
  }>(sql`
    with mine as (
      select i.id, i.target_fact_id,
        f.embedding fe, f.embedding_model fm, t.embedding te, t.embedding_model tm
      from proposal_items i
      left join facts f on f.id = i.fact_id
      left join facts t on t.id = i.target_fact_id
      where i.proposal_id = ${proposal.id} and i.expired_by is null
    ), theirs as (
      select i.id, i.kind, i.position, i.target_fact_id, p.id proposal_id,
        p.created_by, p.created_at, p.decided_by, p.decided_at,
        f.content fact_content, t.content target_content,
        f.embedding fe, f.embedding_model fm, t.embedding te, t.embedding_model tm
      from proposal_items i
      join proposals p on p.id = i.proposal_id
      left join facts f on f.id = i.fact_id
      left join facts t on t.id = i.target_fact_id
      where i.workspace_id = ${workspaceId} and p.id <> ${proposal.id}
        and i.expired_by is null and ${filter}
    )
    select distinct on (theirs.id) mine.id mine_id, theirs.id, theirs.kind,
      theirs.proposal_id, theirs.fact_content, theirs.target_content,
      theirs.created_by, theirs.decided_by, theirs.decided_at,
      theirs.created_at, theirs.position
    from theirs join mine on
      mine.target_fact_id = theirs.target_fact_id
      or (mine.fm = theirs.fm and 1 - (mine.fe <=> theirs.fe) >= ${at})
      or (mine.fm = theirs.tm and 1 - (mine.fe <=> theirs.te) >= ${at})
      or (mine.tm = theirs.fm and 1 - (mine.te <=> theirs.fe) >= ${at})
      or (mine.tm = theirs.tm and 1 - (mine.te <=> theirs.te) >= ${at})
    order by theirs.id, mine.id
  `);
  return (
    rows as ((typeof rows)[number] & {
      created_at: Date | string;
      position: number;
    })[]
  )
    .sort(
      (a, b) =>
        +new Date(a.decided_at ?? a.created_at) -
          +new Date(b.decided_at ?? b.created_at) || a.position - b.position,
    )
    .map((row) => ({
      mineId: row.mine_id,
      id: row.id,
      kind: row.kind,
      proposalId: row.proposal_id,
      factContent: row.fact_content,
      targetContent: row.target_content,
      createdBy: row.created_by,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at == null ? null : new Date(row.decided_at),
    }));
}

// The changes confirmed since the proposal was made that touch its items.
async function conflictsOf(
  tx: Tx,
  workspaceId: string,
  proposal: typeof proposals.$inferSelect,
): Promise<Conflict[]> {
  return (
    await relatedItems(tx, workspaceId, proposal, "confirmed since", RELATED_AT)
  ).map((row) => ({
    itemId: row.mineId,
    changeId: row.id,
    kind: row.kind,
    ...(row.targetContent != null && { before: row.targetContent }),
    ...(row.factContent != null && { after: row.factContent }),
    decidedBy: row.decidedBy ?? "",
    decidedAt: (row.decidedAt ?? new Date(0)).toISOString(),
  }));
}

// The pending items of older proposals that confirming this one expires.
async function expiringOf(
  tx: Tx,
  workspaceId: string,
  proposal: typeof proposals.$inferSelect,
): Promise<ExpiringItem[]> {
  return (
    await relatedItems(
      tx,
      workspaceId,
      proposal,
      "older pending",
      SAME_CLAIM_AT,
    )
  ).map((row) => ({
    proposalId: row.proposalId,
    itemId: row.id,
    kind: row.kind,
    content: row.factContent ?? row.targetContent ?? "",
    createdBy: row.createdBy,
  }));
}

// Expires the older pending items the proposal covers (their facts too), and
// each older proposal left with no live item.
async function expireOlder(
  tx: Tx,
  workspaceId: string,
  proposal: typeof proposals.$inferSelect,
  now: Date,
) {
  const expiring = await expiringOf(tx, workspaceId, proposal);
  if (!expiring.length) return;
  const ids = expiring.map((item) => item.itemId);
  await tx
    .update(proposalItems)
    .set({ expiredBy: proposal.id })
    .where(inArray(proposalItems.id, ids));
  await tx
    .update(facts)
    .set({ status: "expired" })
    .where(
      sql`${facts.id} in (select ${proposalItems.factId} from ${proposalItems} where ${inArray(proposalItems.id, ids)})`,
    );
  await tx
    .update(proposals)
    .set({ status: "expired", decidedAt: now })
    .where(
      and(
        inArray(proposals.id, [...new Set(expiring.map((i) => i.proposalId))]),
        sql`not exists (select 1 from ${proposalItems} where ${proposalItems.proposalId} = ${proposals.id} and ${proposalItems.expiredBy} is null)`,
      ),
    );
}

/** The workspace's pending proposals, oldest first. */
export async function pendingProposals(
  workspaceId: string,
): Promise<Proposal[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.workspaceId, workspaceId),
          eq(proposals.status, "pending"),
        ),
      )
      .orderBy(asc(proposals.createdAt), asc(proposals.id));
    const listed: Proposal[] = [];
    for (const row of rows) listed.push(await cardOf(tx, workspaceId, row));
    return listed;
  });
}

// The proposal as its card shows it; a pending one with what it would expire.
async function cardOf(
  tx: Tx,
  workspaceId: string,
  row: typeof proposals.$inferSelect,
): Promise<Proposal> {
  const items = await itemsOf(tx, row.id);
  return {
    id: row.id,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    ...(row.decidedBy != null && { decidedBy: row.decidedBy }),
    items,
    ...(row.status === "pending" && {
      expires: await expiringOf(tx, workspaceId, row),
    }),
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
      expiredBy: proposalItems.expiredBy,
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
    ...(row.expiredBy != null && { expiredBy: row.expiredBy }),
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
      createdBy: facts.createdBy,
      confirmedBy: facts.confirmedBy,
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
      createdBy: row.createdBy,
      confirmedBy: row.confirmedBy ?? "",
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
