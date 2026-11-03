import type { UIMessage } from "ai";

/** A passage an answer is based on, as shown under the answer. */
export interface Citation {
  id: string;
  label: string;
  text: string;
}

export type ChatMessage = UIMessage<never, { citation: Citation }>;
