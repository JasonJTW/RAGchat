import { toUIMessageStream } from "@ai-sdk/langchain";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { noul } from "@typesafe-ai/sdk";
import {
  type Edited,
  type HistoryEntry,
  searchChunks,
  searchFacts,
} from "../knowledge-base.js";
import { chatModel, systemOne } from "../models.js";
import { type NodeConfig, type State, type Turn, writeText } from "./state.js";

// The 提問 branch: [Jev 檢查] and [檢索] side by side, then [回答＋引用].

/** Something an answer may draw on: a fact or a passage of a file source. */
export interface Evidence {
  id: string;
  kind: "fact" | "passage";
  /** e.g. "知識庫 · 2026-11-14", or "05-projects-and-practice.md › 05 實踐案例 › …" */
  label: string;
  /** The fact, or the passage's original text. */
  text: string;
  /** Present when a member edited the fact's text inline (經編輯). */
  edited?: Edited;
  /**
   * A fact's source as given, shown when its citation is expanded: the
   * message, or the passage of a file it came from, with that passage's label.
   */
  source?: { content: string; createdAt: string; label?: string };
  /** A fact's history chain, oldest first, when it replaced another. */
  history?: HistoryEntry[];
}

/** Evidence an answer cites, as shown under the answer. */
export interface Citation extends Evidence {
  /** The `[n]` the answer marks it with. */
  marker: number;
}

// An answer draws on the best facts, and on the best passages of file
// sources for the context facts leave out (e.g. a decision's reasoning).
const FACTS_PER_ANSWER = 6;
const PASSAGES_PER_ANSWER = 2;

// Dates as the team reads them: YYYY-MM-DD in Taiwan.
const TEAM_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" });

// A member who knows the answer can record it in the same chat.
const REFUSAL_PHRASE = "知識庫裡沒有這件事的資料";
const REFUSAL = `${REFUSAL_PHRASE}。如果你知道，可以直接告訴我，我會整理成提案請團隊確認。`;

// Below this cosine similarity between the question and its best-matching
// evidence, nothing covers the question: refuse without calling the model.
// Calibrated on the answer key with openai/text-embedding-3-small: answerable
// questions score 0.38–0.85, Q12 0.22 (0.27 with the PDF and txt uploaded;
// see the spec's 拒答規則).
const MIN_SIMILARITY = 0.3;

const SYSTEM_PROMPT = `你是「大量交織 megaweaving」團隊 wiki 的助理，回答團隊成員的問題。
- 一律用繁體中文回答，即使使用者用其他語言提問。
- 只根據使用者訊息裡提供的段落作答，不要用段落以外的知識。標為「知識庫」的段落是團隊確認過的事實。
- 先直接回答問題，再用一兩句補上段落裡跟答案同一處的關鍵細節：條件、材料、人數、年份、原因或出處（例如「不是原創」就說出它源自哪裡）。
- 問題問要做哪些事、確認什麼、有哪幾類時，段落裡相關的每一項都要列出，不要只挑其中幾項。
- 每個事實後面用段落編號標出處，例如 [1]、[2]；只標你實際用到的段落，不要另寫「出處：」。
- 只有當段落對同一件事給出不同說法時（例如人數不同）：先給最新且有日期的說法，再列出其他說法的具體數字與各自的年份、來源，並說明這些說法未經確認。說法一致時不要提矛盾。
- 例外：段落完全沒有提到問題要問的事時，不要作答，整個回覆只寫這一句（不加段落編號）：${REFUSAL}
  段落有答案時，照上面的規則完整回答，不要寫這一句。`;

const REWRITE_PROMPT = `把使用者的最新問題改寫成一句不需要上文也看得懂的獨立問題：把代名詞與省略的主詞換成對話裡指的那件事。
- 只輸出改寫後的問題，不要回答、不要解釋。
- 一律用繁體中文。
- 最新問題本身已經完整時，原樣輸出。`;

// Asked of Jev about a first question. Validated on the team FAQ's first
// questions (ticket #33); the examples must stay clear of those questions.
const FIRST_QUESTION_CONTEXT =
  "大量交織 megaweaving 團隊內部 wiki 聊天機器人收到的第一則訊息，之前沒有任何對話。團隊成員用它查詢團隊知識庫：各項計畫與功能、會議決議與理由、估算公式與方法、程式庫更新、分工與負責人、流程與時程。";
const UNNAMED_SUBJECT = noul(
  "這個問題問的是某個特定對象（計畫、功能、會議、決議、公式、文件、人等），但沒說出它的名稱，只用代名詞（它、那、這、其）指它，或直接省略主詞，所以不知道上文就無法知道在問什麼。",
  {
    true: "問題指向一個沒說出名稱的特定對象，例如「它的截止日是哪天？」「那後來誰負責？」「這個改了什麼？」",
    false:
      "問題說出了要問的對象，用專有名稱或團隊裡通用的稱呼都算（例如「新版註冊流程什麼時候上線？」「上個月的會議決定了什麼？」「新人訓練要做哪些事？」），或問的是團隊整體的一般問題（例如「團隊多久開一次會？」），即使用了「這個」「那個」，後面也接著名稱",
  },
);
// Ticket #33, on 10 named and 8 unnamed team first questions: named ones
// scored at most 0.60 (most below 0.4), unnamed ones at least 0.83.
const ASK_WHICH_SUBJECT_AT = 0.7;
// Jev answers in ~0.2 s warm, ~0.4 s cold; past this the chat answers as usual.
const JEV_DEADLINE_MS = 1_500;

const CLARIFY = "請問你指的是哪個計畫或主題？";

// A first message with one of these words records something rather than
// asks (「記下…」「更新一下…」), so it is never asked which subject it means.
// A question that merely mentions one goes unchecked and is answered.
const INPUT_KEYWORD =
  /輸入|記下|記錄|記住|寫入|存入|存進|新增|加入|更新|補充|更正|修正|改成|改為/;

/**
 * Jev 檢查: whether a first question points at something it never names.
 * Skipped, by rule, for a follow-up, a message with an attachment, and one
 * with an input keyword. No JEV_API_KEY, a failure or no answer within the
 * deadline counts as named.
 */
export async function checkSubject(
  state: Pick<State, "turns" | "message" | "attachments">,
): Promise<Pick<State, "clarify">> {
  const jev = systemOne();
  if (
    !jev ||
    state.turns.length ||
    state.attachments ||
    INPUT_KEYWORD.test(state.message)
  )
    return { clarify: false };
  try {
    const { answers } = await jev.systemOne(
      {
        state: { context: FIRST_QUESTION_CONTEXT, question: state.message },
        questions: { unnamedSubject: UNNAMED_SUBJECT },
      },
      { signal: AbortSignal.timeout(JEV_DEADLINE_MS) },
    );
    return { clarify: answers.unnamedSubject.noul >= ASK_WHICH_SUBJECT_AT };
  } catch (error) {
    console.warn("subject check failed, answering as usual:", error);
    return { clarify: false };
  }
}

/**
 * 檢索: the workspace's current confirmed facts (at most 6) and the passages
 * of its confirmed file sources (at most 2) that best match the question,
 * merged best first. A follow-up is first rewritten into a standalone
 * question.
 */
export async function retrieve(
  state: Pick<State, "workspaceId" | "turns" | "message">,
): Promise<Pick<State, "evidence" | "similarity">> {
  const query = state.turns.length
    ? await standaloneQuestion(state.turns, state.message)
    : state.message;
  const [facts, passages] = await Promise.all([
    searchFacts(state.workspaceId, query, FACTS_PER_ANSWER),
    searchChunks(state.workspaceId, query, PASSAGES_PER_ANSWER),
  ]);
  const scored: { similarity: number; evidence: Evidence }[] = facts.map(
    (fact) => ({
      similarity: fact.similarity,
      evidence: {
        id: fact.id,
        kind: "fact",
        label: `知識庫 · ${TEAM_DATE.format(new Date(fact.validFrom))}`,
        text: fact.content,
        ...(fact.edited && { edited: fact.edited }),
        ...(fact.history && { history: fact.history }),
        source: {
          content: fact.source.content,
          createdAt: fact.source.createdAt,
          ...(fact.source.label && { label: fact.source.label }),
        },
      },
    }),
  );
  // Passages keep their fused (vector + keyword) order; each fact goes
  // before the first passage it matches better than.
  const merged: typeof scored = [];
  let f = 0;
  for (const passage of passages) {
    while (f < scored.length && scored[f].similarity > passage.similarity)
      merged.push(scored[f++]);
    merged.push({
      similarity: passage.similarity,
      evidence: {
        id: passage.id,
        kind: "passage",
        label: passage.path.join(" › "),
        text: passage.content,
      },
    });
  }
  merged.push(...scored.slice(f));
  return {
    evidence: merged.map(({ evidence }) => evidence),
    similarity: Math.max(0, ...merged.map((item) => item.similarity)),
  };
}

/**
 * 回答＋引用: streams the answer from the evidence, then the evidence it
 * cites. Asks for the subject instead when Jev found none, and refuses
 * without calling the model when nothing matched well enough.
 */
export async function answer(
  state: Pick<
    State,
    "turns" | "message" | "clarify" | "evidence" | "similarity"
  >,
  config: NodeConfig = {},
): Promise<Pick<State, "reply" | "citations">> {
  if (state.clarify || state.similarity < MIN_SIMILARITY) {
    const text = state.clarify ? CLARIFY : REFUSAL;
    writeText(config, "answer", text);
    return { reply: text, citations: [] };
  }
  const stream = await chatModel("answer").stream(
    [
      new SystemMessage(SYSTEM_PROMPT),
      ...state.turns.map((turn) =>
        turn.role === "user"
          ? new HumanMessage(turn.content)
          : new AIMessage(turn.content),
      ),
      new HumanMessage(
        `段落：\n\n${state.evidence
          .map((e, i) => `[${i + 1}] ${e.label}\n${e.text}`)
          .join("\n\n")}\n\n問題：${state.message}`,
      ),
    ],
    { signal: config.signal },
  );
  let text = "";
  config.writer?.({ type: "text-start", id: "answer" });
  try {
    // The adapter's text deltas go into the answer's one text part, opened
    // above and closed below; its other parts (e.g. reasoning) pass through.
    for await (const part of toUIMessageStream(stream, {
      sendStart: false,
      sendFinish: false,
    })) {
      if (part.type === "text-start" || part.type === "text-end") continue;
      if (part.type === "text-delta") {
        text += part.delta;
        config.writer?.({ ...part, id: "answer" });
      } else config.writer?.(part);
    }
  } catch (error) {
    // The client left mid-answer: nobody reads the rest, and it's no failure.
    if (config.signal?.aborted) return { reply: text, citations: [] };
    throw error;
  }
  config.writer?.({ type: "text-end", id: "answer" });
  // A refusal cites nothing, even if the model marked a passage.
  const citations = text.includes(REFUSAL_PHRASE)
    ? []
    : cited(text, state.evidence);
  for (const citation of citations)
    config.writer?.({ type: "data-citation", id: citation.id, data: citation });
  return { reply: text, citations };
}

async function standaloneQuestion(
  turns: Turn[],
  question: string,
): Promise<string> {
  const { text } = await chatModel("answer").invoke([
    new SystemMessage(REWRITE_PROMPT),
    new HumanMessage(
      `對話：\n${turns
        .map((t) => `${t.role === "user" ? "使用者" : "助理"}：${t.content}`)
        .join("\n")}\n\n最新問題：${question}`,
    ),
  ]);
  return text.trim() || question;
}

// The evidence the answer marks with [n], in marker order. Marks may be
// combined, e.g. [1, 3] or [1][3], and the model sometimes writes them in
// full-width brackets: 〔1〕, ［1］, 【1】.
function cited(text: string, evidence: Evidence[]): Citation[] {
  const markers = new Set<number>();
  for (const [, list] of text.matchAll(
    /[[〔［【](\d+(?:\s*[,，、]\s*\d+)*)[\]〕］】]/g,
  ))
    for (const n of list.split(/[,，、]/)) markers.add(Number(n.trim()));
  return [...markers]
    .filter((n) => n >= 1 && n <= evidence.length)
    .sort((a, b) => a - b)
    .map((n) => ({ ...evidence[n - 1], marker: n }));
}
