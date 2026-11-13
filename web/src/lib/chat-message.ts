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
}

/** A 提案 as the chat shows it on its card (server/openapi.yaml's Proposal). */
export interface Proposal {
  id: string;
  status: "pending" | "confirmed" | "rejected";
  createdBy: string;
  createdAt: string;
  items: {
    id: string;
    kind: "add" | "supersede" | "obsolete";
    factId: string;
    content: string;
    /** Once confirmed, an item left unticked is `rejected`. */
    status: "pending" | "confirmed" | "rejected" | "expired";
    edited?: Edited;
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
