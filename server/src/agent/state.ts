import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { UIMessageChunk } from "ai";
import type { Fact, PendingChange, Proposal } from "../knowledge-base.js";
import type { Citation, Evidence } from "./ask.js";
import type { CorrectionDraft } from "./correct.js";

/** What a message asks of the agent. */
export type Intent = "ask" | "input" | "correct";

/** An earlier message of the conversation, as text. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** The agent's state; each node reads some keys and returns others. */
export const AgentState = Annotation.Root({
  workspaceId: Annotation<string>,
  userId: Annotation<string>,
  /** The conversation before the latest message. */
  turns: Annotation<Turn[]>,
  /** The latest user message. */
  message: Annotation<string>,
  /** How many files the latest user message attaches. */
  attachments: Annotation<number>,
  /**
   * The fact ids the latest answer cited, as the client sent them back;
   * untrusted, so only current facts of the workspace count.
   */
  cited: Annotation<string[]>,
  intents: Annotation<Intent[]>,
  // 輸入
  /** The facts drawn from the message. */
  extracted: Annotation<string[]>,
  proposal: Annotation<Proposal | undefined>,
  // 修正
  /** The part of the message that corrects: all of it, or what precedes its question. */
  correction: Annotation<string>,
  /** The current facts the correction may be about, the cited ones first. */
  candidates: Annotation<Fact[]>,
  /** The changes the correction asks for, one per target fact. */
  drafts: Annotation<CorrectionDraft[]>,
  /** Other pending proposals' changes to the drafts' target facts. */
  conflicts: Annotation<PendingChange[]>,
  // 提問
  /** Whether to ask which subject a first question means instead of answering. */
  clarify: Annotation<boolean>,
  /** What the answer may draw on, best first. */
  evidence: Annotation<Evidence[]>,
  /** How well the best evidence matches the question (cosine similarity). */
  similarity: Annotation<number>,
  /** The answer's text. */
  reply: Annotation<string>,
  citations: Annotation<Citation[]>,
});

export type State = typeof AgentState.State;

/**
 * What a node gets besides the state: `writer` sends UI message chunks to the
 * chat as they come (absent in unit tests), `signal` aborts when the client
 * leaves.
 */
export type NodeConfig = Pick<LangGraphRunnableConfig, "signal"> & {
  writer?: (chunk: UIMessageChunk) => void;
};

/** Writes one whole text part. */
export function writeText(config: NodeConfig, id: string, text: string) {
  config.writer?.({ type: "text-start", id });
  config.writer?.({ type: "text-delta", id, delta: text });
  config.writer?.({ type: "text-end", id });
}
