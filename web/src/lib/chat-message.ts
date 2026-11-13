import type { UIMessage } from "ai";

/** Something an answer is based on, as shown under the answer. */
export interface Citation {
  id: string;
  /** The `[n]` the answer marks it with. */
  marker: number;
  /** A confirmed 事實 of the knowledge base, or a passage of a file 來源. */
  kind: "fact" | "passage";
  /** e.g. "知識庫 · 2026-11-14", or "05-projects-and-practice.md › 05 實踐案例 … › C. 移動微型空間計畫" */
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
  status: "pending" | "confirmed" | "rejected";
  createdBy: string;
  createdAt: string;
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
    status: "pending" | "confirmed" | "rejected";
    edited?: Edited;
    /** The fact it replaces or marks 過時 (取代, 過時). */
    target?: { factId: string; content: string; validFrom: string };
    reason?: string;
    /** When the change takes effect (取代, 過時). */
    effectiveAt?: string;
  }[];
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
