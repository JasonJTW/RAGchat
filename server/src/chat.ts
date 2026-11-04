import type { Response } from "express";
import {
  createUIMessageStream,
  generateText,
  pipeUIMessageStreamToResponse,
  streamText,
  type UIMessageChunk,
} from "ai";
import { retrieve, type Passage } from "./documents.js";
import { CHAT_MODEL, CHAT_PROVIDER_OPTIONS } from "./models.js";

/** A passage an answer cites, as shown under the answer. */
export interface Citation extends Passage {
  /** The `[n]` the answer marks it with. */
  marker: number;
}

const PASSAGES_PER_ANSWER = 6;

/** The fake support address the refusal points to (see the spec's Stubs). */
const SUPPORT_EMAIL = "support@megaweaving.example";

const REFUSAL_PHRASE = "這個問題我無法回答";
const REFUSAL = `${REFUSAL_PHRASE}，請來信客服 ${SUPPORT_EMAIL}。`;

// Below this cosine similarity between the question and its best-matching
// chunk, no document covers the question: refuse without calling the model.
// Calibrated on the answer key with openai/text-embedding-3-small: answerable
// questions score 0.38–0.85, Q12 0.22 (0.27 with the PDF and txt uploaded;
// see the spec's 拒答規則).
const MIN_SIMILARITY = 0.3;

const SYSTEM_PROMPT = `你是「大量交織 megaweaving」的客服助理。
- 一律用繁體中文回答，即使使用者用其他語言提問。
- 只根據使用者訊息裡提供的段落作答，不要用段落以外的知識。
- 先直接回答問題，再用一兩句補上段落裡跟答案同一處的關鍵細節：條件、材料、人數、年份、原因或出處（例如「不是原創」就說出它源自哪裡）。
- 問題問要做哪些事、確認什麼、有哪幾類時，段落裡相關的每一項都要列出，不要只挑其中幾項。
- 每個事實後面用段落編號標出處，例如 [1]、[2]；只標你實際用到的段落，不要另寫「出處：」。
- 只有當段落對同一件事給出不同說法時（例如人數不同）：先給最新且有日期的說法，再列出其他說法與各自的年份、來源，並說明這些說法未經確認。說法一致時不要提矛盾。
- 例外：段落完全沒有提到問題要問的事時，不要作答，整個回覆只寫這一句（不加段落編號）：${REFUSAL}
  段落有答案時，照上面的規則完整回答，不要寫這一句。`;

/** The parts of an AI SDK UIMessage the chat reads. */
export interface ChatMessage {
  role: string;
  parts: { type: string; text?: string }[];
}

const REWRITE_PROMPT = `把使用者的最新問題改寫成一句不需要上文也看得懂的獨立問題：把代名詞與省略的主詞換成對話裡指的那件事。
- 只輸出改寫後的問題，不要回答、不要解釋。
- 一律用繁體中文。
- 最新問題本身已經完整時，原樣輸出。`;

const SUBJECT_CHECK_PROMPT = `判斷使用者的問題有沒有說出它要問的對象的名稱（計畫、平台、社團、人物、活動等的名字）。
- 問題只用「它」「那」「這」「其」等字指一個沒說出名字的對象：沒有。
- 「這個」「那個」後面接著名稱，或名稱出現在問題其他地方：有。
例子：
「這個 megaweaving.net 平台要怎麼註冊？」→ 有
「那個旅梯計畫的起點在哪裡？」→ 有
「大量交織這個 FB 社團是誰創的？」→ 有
「它是什麼時候開始的？」→ 沒有
「其中哪一個最受歡迎？」→ 沒有
「那這個要怎麼申請？」→ 沒有
只輸出「有」或「沒有」，不要解釋。`;

// A first question with one of these may point at something it never names.
const POINTING_WORD = /[它那這其]/;

const CLARIFY = "請問你指的是哪個計畫或主題？";

/**
 * Answers the latest user message from the stored documents, streamed. A
 * follow-up is first rewritten into a standalone question for retrieval; the
 * answer still sees the whole conversation. A first question with a pointing
 * word (它／那／這／其) is checked for naming its subject while the answer is
 * prepared; the answer is held back until the check passes, and replaced by
 * a request to name the subject when it fails.
 */
export function streamAnswer(res: Response, messages: ChatMessage[]) {
  const turns = textTurns(messages);
  const question = turns.at(-1)?.role === "user" ? turns.pop()!.content : "";
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const abort = new AbortController();
      // A client that leaves stops the answer too (after a full answer, a no-op).
      res.once("close", () => abort.abort());
      let parts: AsyncIterable<UIMessageChunk> | UIMessageChunk[] = answerParts(
        turns,
        question,
        abort.signal,
      );
      if (!turns.length && POINTING_WORD.test(question)) {
        parts = startedEarly(parts);
        let named = false;
        try {
          named = await namesItsSubject(question);
        } finally {
          // The held answer runs on its own: stop it on every path that
          // won't read it, a failed check included.
          if (!named) abort.abort();
        }
        if (!named) {
          parts = [
            { type: "text-delta", id: "answer", delta: CLARIFY },
            { type: "text-end", id: "answer" },
          ];
        }
      }
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "answer" });
      for await (const part of parts) writer.write(part);
      writer.write({ type: "finish" });
    },
    onError: (error) => {
      console.error("chat failed:", error);
      return "回答時發生錯誤，請稍後再試。";
    },
  });
  return pipeUIMessageStreamToResponse({
    response: res,
    stream,
    // Stops the Next.js rewrite proxy from gzipping the stream, which buffers
    // it until the answer is complete.
    headers: { "Cache-Control": "no-cache, no-transform" },
  });
}

// The answer's text deltas, its text end, then its citations.
async function* answerParts(
  turns: Turn[],
  question: string,
  abortSignal: AbortSignal,
): AsyncGenerator<UIMessageChunk> {
  const query = turns.length
    ? await standaloneQuestion(turns, question)
    : question;
  const { passages, similarity } = await retrieve(query, PASSAGES_PER_ANSWER);
  if (abortSignal.aborted) return;
  if (similarity < MIN_SIMILARITY) {
    yield { type: "text-delta", id: "answer", delta: REFUSAL };
    yield { type: "text-end", id: "answer" };
    return;
  }
  const result = streamText({
    model: CHAT_MODEL,
    system: SYSTEM_PROMPT,
    providerOptions: CHAT_PROVIDER_OPTIONS,
    abortSignal,
    messages: [
      ...turns,
      {
        role: "user",
        content: `段落：\n\n${passages
          .map((p, i) => `[${i + 1}] ${p.label}\n${p.text}`)
          .join("\n\n")}\n\n問題：${question}`,
      },
    ],
  });
  let answer = "";
  for await (const delta of result.textStream) {
    answer += delta;
    yield { type: "text-delta", id: "answer", delta };
  }
  yield { type: "text-end", id: "answer" };
  // A refusal cites nothing, even if the model marked a passage.
  if (!answer.includes(REFUSAL_PHRASE))
    for (const citation of cited(answer, passages))
      yield { type: "data-citation", id: citation.id, data: citation };
}

async function namesItsSubject(question: string): Promise<boolean> {
  const { text } = await generateText({
    model: CHAT_MODEL,
    system: SUBJECT_CHECK_PROMPT,
    providerOptions: CHAT_PROVIDER_OPTIONS,
    prompt: `問題：${question}`,
  });
  return !text.includes("沒有");
}

// Starts pulling `source` now, holding what arrives until it is iterated.
// A failure surfaces only if it is iterated.
function startedEarly<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const held: T[] = [];
  let finished = false;
  let failure: Error | undefined;
  let wake = () => {};
  void (async () => {
    try {
      for await (const item of source) {
        held.push(item);
        wake();
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      finished = true;
      wake();
    }
  })();
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; ; i++) {
        while (i >= held.length && !finished)
          await new Promise<void>((resolve) => (wake = resolve));
        if (i < held.length) yield held[i];
        else if (failure) throw failure;
        else return;
      }
    },
  };
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

// The conversation as plain-text turns; citations and other parts dropped.
function textTurns(messages: ChatMessage[]): Turn[] {
  return messages.flatMap((message) =>
    message.role === "user" || message.role === "assistant"
      ? [
          {
            role: message.role,
            content: message.parts
              .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
              .join(""),
          },
        ]
      : [],
  );
}

async function standaloneQuestion(
  turns: Turn[],
  question: string,
): Promise<string> {
  const { text } = await generateText({
    model: CHAT_MODEL,
    system: REWRITE_PROMPT,
    providerOptions: CHAT_PROVIDER_OPTIONS,
    prompt: `對話：\n${turns
      .map((t) => `${t.role === "user" ? "使用者" : "助理"}：${t.content}`)
      .join("\n")}\n\n最新問題：${question}`,
  });
  return text.trim() || question;
}

// The passages the answer marks with [n], in marker order. Marks may be
// combined, e.g. [1, 3] or [1][3], and the model sometimes writes them in
// full-width brackets: 〔1〕, ［1］, 【1】.
function cited(answer: string, passages: Passage[]): Citation[] {
  const markers = new Set<number>();
  for (const [, list] of answer.matchAll(
    /[[〔［【](\d+(?:\s*[,，、]\s*\d+)*)[\]〕］】]/g,
  ))
    for (const n of list.split(/[,，、]/)) markers.add(Number(n.trim()));
  return [...markers]
    .filter((n) => n >= 1 && n <= passages.length)
    .sort((a, b) => a - b)
    .map((n) => ({ ...passages[n - 1], marker: n }));
}
