import { END, START, StateGraph } from "@langchain/langgraph";
import { answer, checkSubject, retrieve } from "./ask.js";
import {
  compareConflicts,
  draftCorrection,
  locateTargets,
  proposeCorrection,
} from "./correct.js";
import { extract, propose } from "./input.js";
import { classifyIntent } from "./intent.js";
import { AgentState } from "./state.js";

// The agent (ADR-0002): the code, not the model, decides the flow.
//
//   [判斷意圖] ┬─ 提問 ─→ [Jev 檢查] ┬→ [回答＋引用]
//             │          [檢索] ───┘      ↑ (waits for 修正, when both)
//             ├─ 輸入 ─→ [抽取] → [建立提案]
//             └─ 修正 ─→ [定位目標事實] → [起草修正] → [比對衝突] → [建立提案]
//
// A message that corrects and asks runs both branches side by side. The
// answer is deferred until the correction is proposed: it still answers from
// the confirmed facts (retrieval ran before the proposal existed) and notes
// that the correction is pending.
//
// Each node takes the state and returns the keys it sets; the reply reaches
// the chat through the `custom` stream (see state.ts's NodeConfig). A turn
// that proposes ends there: confirming happens over REST (ADR-0003).
export const agent = new StateGraph(AgentState)
  .addNode("classifyIntent", classifyIntent)
  .addNode("checkSubject", checkSubject)
  .addNode("retrieve", retrieve)
  .addNode("answer", answer, { defer: true })
  .addNode("extract", extract)
  .addNode("propose", propose)
  .addNode("locateTargets", locateTargets)
  .addNode("draftCorrection", draftCorrection)
  .addNode("compareConflicts", compareConflicts)
  .addNode("proposeCorrection", proposeCorrection)
  .addEdge(START, "classifyIntent")
  .addConditionalEdges(
    "classifyIntent",
    ({ intents }) =>
      intents.includes("input")
        ? ["extract"]
        : [
            ...(intents.includes("correct") ? ["locateTargets"] : []),
            ...(intents.includes("ask") ? ["checkSubject", "retrieve"] : []),
          ],
    ["extract", "locateTargets", "checkSubject", "retrieve"],
  )
  // Retrieval runs while Jev checks the question.
  .addEdge(["checkSubject", "retrieve"], "answer")
  .addEdge("answer", END)
  .addEdge("extract", "propose")
  .addEdge("propose", END)
  .addEdge("locateTargets", "draftCorrection")
  .addEdge("draftCorrection", "compareConflicts")
  .addEdge("compareConflicts", "proposeCorrection")
  .addEdge("proposeCorrection", END)
  .compile();
