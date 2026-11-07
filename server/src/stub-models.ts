import {
  MockEmbeddingModelV4,
  MockLanguageModelV4,
  MockProviderV4,
} from "ai/test";
import { simulateReadableStream } from "ai";
import type { SystemOne } from "./models.js";

/** The fake chat model's next reply and the prompts it was sent. */
export interface StubChat {
  /** Streamed back one character at a time. */
  reply: string;
  /** Each prompt flattened to text: the system prompt, then each message. */
  prompts: string[];
  /** Returned whole when a follow-up is rewritten into a standalone question. */
  rewrite: string;
  /** Each rewrite prompt, flattened like `prompts`. */
  rewritePrompts: string[];
}

/** The fake Jev's answer to every Noul and the state of each request. */
export interface StubJev {
  /** The probability every Noul question is answered with. */
  noul: number;
  /** Each request's state, in call order. */
  states: unknown[];
  /** When set, every request fails with this error. */
  error?: Error;
  /** When set, a request never answers; it fails once its signal aborts. */
  hangs?: boolean;
  /** When set, a request answers after this many milliseconds. */
  delayMs?: number;
}

export const STUB_CHAT_REPLY = "這是假模型的回答，依據第 1 段。[1]";
export const STUB_CHAT_REWRITE = "旅梯計畫總共巡迴了幾站？是哪幾年？";

/**
 * Replaces the AI Gateway and Jev with fakes, without a network call: any
 * embedding model id returns fixed vectors derived from the text and the id,
 * any chat model id streams `chat.reply` and returns `chat.rewrite` whole, and
 * Jev answers every Noul with `jev.noul`. Returns the texts each embedding
 * model id was asked to embed, the chat and Jev stubs, and `vectors`: fixed
 * embeddings for given texts, overriding the derived ones.
 */
export function installStubModels(): {
  embedded: Record<string, string[]>;
  chat: StubChat;
  jev: StubJev;
  vectors: Map<string, number[]>;
} {
  const embedded: Record<string, string[]> = {};
  const chat: StubChat = {
    reply: STUB_CHAT_REPLY,
    prompts: [],
    rewrite: STUB_CHAT_REWRITE,
    rewritePrompts: [],
  };
  const vectors = new Map<string, number[]>();
  const provider = new MockProviderV4();
  provider.embeddingModel = (modelId: string) =>
    new MockEmbeddingModelV4({
      modelId,
      maxEmbeddingsPerCall: 2048,
      doEmbed: ({ values }) => {
        (embedded[modelId] ??= []).push(...values);
        return Promise.resolve({
          embeddings: values.map(
            (text) => vectors.get(text) ?? stubVector(modelId, text),
          ),
          warnings: [],
        });
      },
    });
  provider.languageModel = (modelId: string) =>
    new MockLanguageModelV4({
      modelId,
      doGenerate: ({ prompt }) => {
        chat.rewritePrompts.push(flatten(prompt));
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: chat.rewrite,
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: NO_USAGE,
          warnings: [],
        });
      },
      doStream: ({ prompt }) => {
        chat.prompts.push(flatten(prompt));
        return Promise.resolve({
          stream: simulateReadableStream({
            chunkDelayInMs: 10,
            chunks: [
              { type: "text-start" as const, id: "1" },
              ...Array.from(chat.reply, (delta) => ({
                type: "text-delta" as const,
                id: "1",
                delta,
              })),
              { type: "text-end" as const, id: "1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                usage: NO_USAGE,
              },
            ],
          }),
        });
      },
    });
  globalThis.AI_SDK_DEFAULT_PROVIDER = provider;
  const jev: StubJev = { noul: 0, states: [] };
  const fakeJev = {
    systemOne(
      request: { state: unknown; questions: Record<string, unknown> },
      options?: { signal?: AbortSignal },
    ) {
      jev.states.push(request.state);
      if (jev.error) return Promise.reject(jev.error);
      if (jev.hangs)
        return new Promise((_, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
      const delay = new Promise((resolve) =>
        setTimeout(resolve, jev.delayMs ?? 0),
      );
      return delay.then(() => ({
        model: "jev-stub",
        answers: Object.fromEntries(
          Object.keys(request.questions).map((id) => [
            id,
            { type: "noul", noul: jev.noul },
          ]),
        ),
        usage: { input_tokens: 0, output_tokens: 0 },
      }));
    },
  };
  globalThis.SYSTEM_ONE_CLIENT = fakeJev as unknown as SystemOne;
  return { embedded, chat, jev, vectors };
}

const NO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// The system prompt, then each message, as text.
function flatten(
  prompt: { content: string | { type: string; text?: string }[] }[],
): string {
  return prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
            .join(""),
    )
    .join("\n\n");
}

// Hashes character bigrams into 64 buckets, so texts sharing words point the
// same way.
function stubVector(modelId: string, text: string): number[] {
  const vector = new Array<number>(64).fill(0);
  const chars = Array.from(`${modelId}\n${text}`);
  for (let i = 0; i < chars.length - 1; i++) {
    let hash = 0;
    for (const c of chars[i] + chars[i + 1])
      hash = (hash * 31 + c.codePointAt(0)!) >>> 0;
    vector[hash % 64] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((x) => x / norm);
}
