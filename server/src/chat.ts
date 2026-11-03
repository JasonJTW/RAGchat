import type { Response } from "express";
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  streamText,
  type UIMessage,
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
// questions score 0.38–0.73, Q12 0.22 (see the spec's 拒答規則).
const MIN_SIMILARITY = 0.3;

const SYSTEM_PROMPT = `你是「大量交織 megaweaving」的客服助理。
- 一律用繁體中文回答，即使使用者用其他語言提問。
- 只根據使用者訊息裡提供的段落作答，不要用段落以外的知識。
- 先直接回答問題，再用一兩句補上段落裡跟答案同一處的關鍵細節：條件、材料、人數、年份、原因或出處（例如「不是原創」就說出它源自哪裡）。
- 每個事實後面用段落編號標出處，例如 [1]、[2]；只標你實際用到的段落，不要另寫「出處：」。
- 只有當段落對同一件事給出不同說法時（例如人數不同）：先給最新且有日期的說法，再列出其他說法與各自的年份、來源，並說明這些說法未經確認。說法一致時不要提矛盾。
- 例外：段落完全沒有提到問題要問的事時，不要作答，整個回覆只寫這一句（不加段落編號）：${REFUSAL}
  段落有答案時，照上面的規則完整回答，不要寫這一句。`;

/** Answers the latest user message from the stored documents, streamed. */
export function streamAnswer(res: Response, messages: UIMessage[]) {
  const question = latestUserText(messages);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const { passages, similarity } = await retrieve(
        question,
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
        prompt: `段落：\n\n${passages
          .map((p, i) => `[${i + 1}] ${p.label}\n${p.text}`)
          .join("\n\n")}\n\n問題：${question}`,
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

function latestUserText(messages: UIMessage[]): string {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  return (latest?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

// The passages the answer marks with [n], in marker order. Marks may be
// combined, e.g. [1, 3] or [1][3].
function cited(answer: string, passages: Passage[]): Citation[] {
  const markers = new Set<number>();
  for (const [, list] of answer.matchAll(/\[(\d+(?:\s*[,，、]\s*\d+)*)\]/g))
    for (const n of list.split(/[,，、]/)) markers.add(Number(n.trim()));
  return [...markers]
    .filter((n) => n >= 1 && n <= passages.length)
    .sort((a, b) => a - b)
    .map((n) => ({ ...passages[n - 1], marker: n }));
}
