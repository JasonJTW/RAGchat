import {
  MockEmbeddingModelV4,
  MockLanguageModelV4,
  MockProviderV4,
} from "ai/test";
import { simulateReadableStream } from "ai";

/** The fake chat model's next reply and the prompts it was sent. */
export interface StubChat {
  /** Streamed back one character at a time. */
  reply: string;
  /** Each prompt flattened to text: the system prompt, then each message. */
  prompts: string[];
}

export const STUB_CHAT_REPLY = "這是假模型的回答，依據第 1 段。[1]";

/**
 * Replaces the AI Gateway with a fake provider, without a network call: any
 * embedding model id returns fixed vectors derived from the text and the id,
 * and any chat model id streams `chat.reply`. Returns the texts each embedding
 * model id was asked to embed, and the chat stub.
 */
export function installStubModels(): {
  embedded: Record<string, string[]>;
  chat: StubChat;
} {
  const embedded: Record<string, string[]> = {};
  const chat: StubChat = { reply: STUB_CHAT_REPLY, prompts: [] };
  const provider = new MockProviderV4();
  provider.embeddingModel = (modelId: string) =>
    new MockEmbeddingModelV4({
      modelId,
      maxEmbeddingsPerCall: 2048,
      doEmbed: ({ values }) => {
        (embedded[modelId] ??= []).push(...values);
        return Promise.resolve({
          embeddings: values.map((text) => stubVector(modelId, text)),
          warnings: [],
        });
      },
    });
  provider.languageModel = (modelId: string) =>
    new MockLanguageModelV4({
      modelId,
      doStream: ({ prompt }) => {
        chat.prompts.push(
          prompt
            .map((message) =>
              typeof message.content === "string"
                ? message.content
                : message.content
                    .map((part) => (part.type === "text" ? part.text : ""))
                    .join(""),
            )
            .join("\n\n"),
        );
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
                usage: {
                  inputTokens: {
                    total: 0,
                    noCache: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 0, text: 0, reasoning: 0 },
                },
              },
            ],
          }),
        });
      },
    });
  globalThis.AI_SDK_DEFAULT_PROVIDER = provider;
  return { embedded, chat };
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
