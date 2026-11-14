import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { RunnableLambda } from "@langchain/core/runnables";
import { EMBEDDING_DIMENSIONS } from "./db/schema.js";
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
  /**
   * Answers `withStructuredOutput(schema, { name }).invoke(messages)` from
   * the last message's text. By default, for the name "correction" it
   * corrects as `stubCorrections` does; for "entities" it names entities as
   * `stubEntities` does; for "entity-link" it makes every mention a new
   * entity; otherwise it extracts facts: each sentence (split at 。 and
   * line breaks) is one fact.
   */
  structured: (text: string, name?: string) => unknown;
  /** Each structured-output prompt, flattened like `prompts`. */
  structuredPrompts: string[];
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
    structured: (text, name) =>
      name === "correction"
        ? stubCorrections(text)
        : name === "entities"
          ? stubEntities(text)
          : name === "entity-link"
            ? { links: [] }
            : sentencesAsFacts(text),
    structuredPrompts: [],
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

  // The real models answer in a given shape by tool calling; this one asks
  // `chat.structured`.
  override withStructuredOutput(_schema: unknown, options?: { name?: string }) {
    return RunnableLambda.from((messages: BaseMessage[]) => {
      this.chat.structuredPrompts.push(flatten(messages));
      return this.chat.structured(messages.at(-1)?.text ?? "", options?.name);
    }) as unknown as ReturnType<BaseChatModel["withStructuredOutput"]>;
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
    // Zero-padded to the stored length; padding leaves cosines unchanged.
    return Promise.resolve(
      texts.map((text) =>
        padded(this.vectors.get(text) ?? stubVector(this.model, text)),
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

function padded(vector: number[]): number[] {
  return vector.length >= EMBEDDING_DIMENSIONS
    ? vector
    : [
        ...vector,
        ...new Array<number>(EMBEDDING_DIMENSIONS - vector.length).fill(0),
      ];
}

// The default structured answer: every sentence of the text is a fact.
function sentencesAsFacts(text: string) {
  return {
    facts: text
      .split(/[。\n]+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .map((content) => ({ content })),
  };
}

/**
 * The default entities, read from [連結實體]'s numbered facts: each 「name」
 * in a fact is an entity of kind "other", and a fact naming two or more
 * relates the first to the second by the words between them (e.g.
 * 「王小明」負責「回收模組」: 王小明 負責 回收模組).
 */
function stubEntities(text: string) {
  return {
    facts: [...text.matchAll(/^\[(\d+)\] (.*)$/gm)].map(([, n, content]) => {
      const names = [...content.matchAll(/「([^」]+)」/g)];
      const between =
        names.length > 1
          ? content
              .slice(names[0].index + names[0][0].length, names[1].index)
              .trim()
          : "";
      return {
        fact: Number(n),
        entities: names.map(([, name]) => ({ name, kind: "other" })),
        relations: between
          ? [{ from: names[0][1], relation: between, to: names[1][1] }]
          : [],
      };
    }),
  };
}

/**
 * The default correction, read from 起草修正's message (agent/correct.ts):
 * 「X 不是 A，是 B」 replaces A with B in the first listed fact that mentions
 * both X and A; a message saying a fact is 過時 or no longer used marks the
 * first listed fact mentioning its subject 過時. Anything else corrects
 * nothing.
 */
function stubCorrections(text: string) {
  const facts = [...text.matchAll(/^\[(\d+)\] (.*)$/gm)].map(
    ([, n, content]) => ({ n: Number(n), content }),
  );
  const message = /成員的更正：([\s\S]*)$/.exec(text)?.[1].trim() ?? "";
  const replaced = /^(.+?)不是(.+?)[，,]\s*(?:而)?是(.+?)[。.]?$/.exec(message);
  if (replaced) {
    const [, subject, from, to] = replaced.map((part) => part.trim());
    const fact = facts.find(
      (f) => f.content.includes(subject) && f.content.includes(from),
    );
    return {
      corrections: fact
        ? [
            {
              fact: fact.n,
              kind: "supersede",
              content: fact.content.replaceAll(from, to),
              reason: message,
              effectiveDate: null,
            },
          ]
        : [],
    };
  }
  const obsolete = /^(.+?)(?:已經|已)?(?:過時|不再使用)/.exec(message);
  const fact =
    obsolete && facts.find((f) => f.content.includes(obsolete[1].trim()));
  return {
    corrections: fact
      ? [
          {
            fact: fact.n,
            kind: "obsolete",
            content: null,
            reason: message,
            effectiveDate: null,
          },
        ]
      : [],
  };
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
