import type { UIMessage } from "ai";

/** Something an answer is based on, as shown under the answer. */
export interface Citation {
  id: string;
  /** The `[n]` the answer marks it with. */
  marker: number;
  /** A 事實 (confirmed, or 待確認 with `proposal`), or a passage of a file 來源. */
  kind: "fact" | "passage";
  /** e.g. "知識庫 · 2026-11-14", "待確認 · 2026-11-14", or "05-projects-and-practice.md › 05 實踐案例 … › C. 移動微型空間計畫" */
  label: string;
  /** The fact, or the passage's original text, shown when expanded. */
  text: string;
  /** Present when a 成員 edited the fact's text on its 提案 card. */
  edited?: Edited;
  /**
   * A fact's 來源 as it was given, shown when expanded: the message, or the
   * passage of the file it came from, labelled with that passage's path.
   */
  source?: { content: string; createdAt: string; label?: string };
  /** A fact's versions, oldest first, ending with it; when it replaced one. */
  history?: HistoryEntry[];
  /** Present when the fact is 待確認: the 提案 it belongs to, to confirm here. */
  proposal?: Proposal;
  /** A 待確認 fact's: the confirmed fact it would replace, cited before it. */
  replaces?: string;
}

/** One version in a fact's history chain (e.g. 取代率 → 回收率 → 取代率). */
export interface HistoryEntry {
  factId: string;
  content: string;
  validFrom: string;
  /** When the next version replaced it; null for the current one. */
  validTo: string | null;
  /** Why it replaced the version before it. */
  reason?: string;
}

/** A 提案 as the chat shows it on its card (server/openapi.yaml's Proposal). */
export interface Proposal {
  id: string;
  /** expired: a newer proposal's confirmation expired every item. */
  status: "pending" | "confirmed" | "rejected" | "expired";
  /** Its 來源 (absent on cards saved before hard delete). */
  sourceId?: string;
  createdBy: string;
  createdAt: string;
  /** Who confirmed or rejected it. */
  decidedBy?: string;
  /** While pending: older pending items that confirming it would expire. */
  expires?: ExpiringItem[];
  /** The 實體 its facts speak of (absent on cards saved before entities). */
  entities?: ProposalEntity[];
  /** 取代 and 過時 items first, then 新增 ones. */
  items: {
    id: string;
    kind: "add" | "supersede" | "obsolete";
    /** The fact it adds (新增, 取代); absent for 過時. */
    factId?: string;
    content?: string;
    /**
     * 待確認 while the proposal is; once decided, whether the item took
     * effect (`rejected` when the proposal was rejected or it was unticked).
     */
    status: "pending" | "confirmed" | "rejected" | "expired";
    edited?: Edited;
    /** The fact it replaces or marks 過時 (取代, 過時). */
    target?: { factId: string; content: string; validFrom: string };
    reason?: string;
    /** When the change takes effect (取代, 過時), or a 新增 fact became true. */
    effectiveAt?: string;
    /** The newer proposal whose confirmation expired it (已過期). */
    expiredBy?: string;
    /** The entities its fact speaks of (ids into `entities`). */
    entityIds?: string[];
  }[];
}

/** A 實體 a 提案's facts speak of; new until a confirmed fact does. */
export interface ProposalEntity {
  id: string;
  name: string;
  kind: string;
  new: boolean;
  /** For a new entity: existing ones it may be instead, to relink it to. */
  candidates?: { id: string; name: string }[];
}

/** A pending item of an older 提案 that confirming a newer one expires. */
export interface ExpiringItem {
  proposalId: string;
  itemId: string;
  kind: "add" | "supersede" | "obsolete";
  /** Its fact, or for 過時 the fact it would end. */
  content: string;
  createdBy: string;
}

/**
 * A change confirmed since a 提案 was made that touches one of its items;
 * confirming is stopped until the member has seen it (409 from confirm).
 */
export interface Conflict {
  itemId: string;
  changeId: string;
  kind: "add" | "supersede" | "obsolete";
  /** The fact it replaced or marked 過時. */
  before?: string;
  /** The fact it added. */
  after?: string;
  decidedBy: string;
  decidedAt: string;
}

/** A fact a 成員 edited inline: who, and the text as extracted. */
export interface Edited {
  by: string;
  originalContent: string;
}

export type ChatMessage = UIMessage<
  never,
  { citation: Citation; proposal: Proposal }
>;
