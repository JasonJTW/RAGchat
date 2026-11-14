import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { UIMessageChunk } from "ai";
import type { Fact, PendingChange, Proposal } from "../knowledge-base.js";
import type { Citation, Evidence } from "./ask.js";
import type { Skipped, Upload } from "./input.js";
import type { CorrectionDraft } from "./correct.js";
import type { ModelPurpose } from "../models.js";
import type { Caller } from "../workspaces.js";

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
  /** A 訪客 is answered by GUEST_MODEL (see `purposeOf`). */
  role: Annotation<Caller["role"]>,
  /** The conversation before the latest message. */
  turns: Annotation<Turn[]>,
  /** The latest user message. */
  message: Annotation<string>,
  /** How many files the latest user message attaches. */
  attachments: Annotation<number>,
  /** The files the latest user message attaches. */
  files: Annotation<Upload[]>,
  /**
   * The fact ids the latest answer cited, as the client sent them back;
   * untrusted, so only current facts of the workspace count.
   */
  cited: Annotation<string[]>,
  intents: Annotation<Intent[]>,
  // 輸入 (the subgraph in input.ts keeps its own keys besides these)
  /** The proposals the input made, one per source. */
  proposals: Annotation<Proposal[]>,
  skipped: Annotation<Skipped[]>,
  // 修正
  /** The proposal the correction made. */
  proposal: Annotation<Proposal | undefined>,
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

/** The model a node uses for its purpose: GUEST_MODEL for every 訪客 call. */
export function purposeOf(
  state: { role?: Caller["role"] },
  purpose: ModelPurpose,
): ModelPurpose {
  return state.role === "guest" ? "guest" : purpose;
}
