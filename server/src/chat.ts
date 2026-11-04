import type { Response } from "express";
import {
  createUIMessageStream,
  generateText,
  pipeUIMessageStreamToResponse,
  streamText,
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

/**
 * Answers the latest user message from the stored documents, streamed. A
 * follow-up is first rewritten into a standalone question for retrieval; the
 * answer still sees the whole conversation.
 */
export function streamAnswer(res: Response, messages: ChatMessage[]) {
  const turns = textTurns(messages);
  const question = turns.at(-1)?.role === "user" ? turns.pop()!.content : "";
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const query = turns.length
        ? await standaloneQuestion(turns, question)
        : question;
      const { passages, similarity } = await retrieve(
        query,
        PASSAGES_PER_ANSWER,
      );
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "answer" });
      if (similarity < MIN_SIMILARITY) {
        writer.write({ type: "text-delta", id: "answer", delta: REFUSAL });
        writer.write({ type: "text-end", id: "answer" });
        writer.write({ type: "finish" });
        return;
      }
      const result = streamText({
        model: CHAT_MODEL,
        system: SYSTEM_PROMPT,
        providerOptions: CHAT_PROVIDER_OPTIONS,
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
        writer.write({ type: "text-delta", id: "answer", delta });
      }
      writer.write({ type: "text-end", id: "answer" });
      // A refusal cites nothing, even if the model marked a passage.
      if (!answer.includes(REFUSAL_PHRASE))
        for (const citation of cited(answer, passages))
          writer.write({
            type: "data-citation",
            id: citation.id,
            data: citation,
          });
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
