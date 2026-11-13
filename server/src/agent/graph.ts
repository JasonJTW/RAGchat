import { END, START, StateGraph } from "@langchain/langgraph";
import { answer, checkSubject, retrieve } from "./ask.js";
import { inputGraph } from "./input.js";
import { classifyIntent } from "./intent.js";
import { AgentState } from "./state.js";

// The agent (ADR-0002): the code, not the model, decides the flow.
//
//   [判斷意圖] ┬─ 提問 ─→ [Jev 檢查] ┬→ [回答＋引用]
//             │          [檢索] ───┘
//             └─ 輸入 ─→ (輸入子圖) [轉文字] → [切 chunk] → [抽取] → [建立提案]
//
// Each node takes the state and returns the keys it sets; the reply reaches
// the chat through the `custom` stream (see state.ts's NodeConfig). A turn
// that proposes ends there: confirming happens over REST (ADR-0003).
export const agent = new StateGraph(AgentState)
  .addNode("classifyIntent", classifyIntent)
  .addNode("checkSubject", checkSubject)
  .addNode("retrieve", retrieve)
  .addNode("answer", answer)
  .addNode("input", inputGraph)
  .addEdge(START, "classifyIntent")
  .addConditionalEdges(
    "classifyIntent",
    ({ intents }) =>
      intents.includes("input") ? ["input"] : ["checkSubject", "retrieve"],
    ["input", "checkSubject", "retrieve"],
  )
  // Retrieval runs while Jev checks the question.
  .addEdge(["checkSubject", "retrieve"], "answer")
  .addEdge("answer", END)
  .addEdge("input", END)
  .compile();
