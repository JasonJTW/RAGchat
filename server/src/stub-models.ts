import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
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
 * Replaces the models (models.ts) and Jev with fakes, without a network call: any
 * embedding model id returns fixed vectors derived from the text and the id,
 * any chat model id streams `chat.reply` and, when invoked, returns
 * `chat.rewrite` whole, and
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
  globalThis.MODEL_STUBS = {
    chat: (modelId) => new StubChatModel(modelId, chat),
    embeddings: (modelId) => new StubEmbeddings(modelId, embedded, vectors),
  };
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

// A chat model that streams `chat.reply` one character every 10 ms, and
// answers an invoke with `chat.rewrite`.
class StubChatModel extends BaseChatModel {
  constructor(
    readonly model: string,
    private readonly chat: StubChat,
  ) {
    super({});
  }

  _llmType() {
    return "stub";
  }

  _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.chat.rewritePrompts.push(flatten(messages));
    const text = this.chat.rewrite;
    return Promise.resolve({
      generations: [{ text, message: new AIMessage(text) }],
    });
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
  ): AsyncGenerator<ChatGenerationChunk> {
    this.chat.prompts.push(flatten(messages));
    for (const delta of this.chat.reply) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield new ChatGenerationChunk({
        text: delta,
        message: new AIMessageChunk(delta),
      });
    }
  }
}

// Embeddings derived from the text and the model id, or taken from `vectors`.
class StubEmbeddings extends Embeddings {
  constructor(
    readonly model: string,
    private readonly embedded: Record<string, string[]>,
    private readonly vectors: Map<string, number[]>,
  ) {
    super({});
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    (this.embedded[this.model] ??= []).push(...texts);
    return Promise.resolve(
      texts.map(
        (text) => this.vectors.get(text) ?? stubVector(this.model, text),
      ),
    );
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }
}

// The system prompt, then each message, as text.
function flatten(messages: BaseMessage[]): string {
  return messages.map((message) => message.text).join("\n\n");
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
