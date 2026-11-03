import type { UIMessage } from "ai";

/** A passage an answer is based on, as shown under the answer. */
export interface Citation {
  id: string;
  /** The `[n]` the answer marks it with. */
  marker: number;
  /** e.g. "05-projects-and-practice.md › 05 實踐案例 … › C. 移動微型空間計畫" */
  label: string;
  /** The passage's original text, shown when the citation is expanded. */
  text: string;
}

export type ChatMessage = UIMessage<never, { citation: Citation }>;
