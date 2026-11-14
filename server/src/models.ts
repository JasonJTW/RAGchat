import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Embeddings } from "@langchain/core/embeddings";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

// Every model the server calls is built here (ADR-0002). Model ids are
// `<provider>/<model>` strings (e.g. `openai/gpt-5-mini`,
// `anthropic/claude-sonnet-5-5`) served by AI Gateway's OpenAI-compatible
// endpoint, so switching vendor is an env change. Env is read on every call.

const AI_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

/** What a chat model is for; each purpose has its own env variable. */
export type ModelPurpose = "answer" | "extract" | "guest";

/** An embedding model, with the id stored next to the vectors it made. */
export type EmbeddingModel = Embeddings & { model: string };

declare global {
  // Set by the test stub (stub-models.ts) in place of the real models.
  var MODEL_STUBS:
    | {
        chat(modelId: string): BaseChatModel;
        embeddings(modelId: string): EmbeddingModel;
      }
    | undefined;
}

/**
 * The chat model for a purpose: `answer` uses CHAT_MODEL, `extract`
 * EXTRACT_MODEL and `guest` GUEST_MODEL, each falling back to CHAT_MODEL.
 */
export function chatModel(purpose: ModelPurpose): BaseChatModel {
  const chat = env("CHAT_MODEL") ?? "openai/gpt-5-mini";
  const modelId =
    purpose === "extract"
      ? (env("EXTRACT_MODEL") ?? chat)
      : purpose === "guest"
        ? (env("GUEST_MODEL") ?? chat)
        : chat;
  if (globalThis.MODEL_STUBS) return globalThis.MODEL_STUBS.chat(modelId);
  return new ChatOpenAI({
    model: modelId,
    apiKey: process.env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: AI_GATEWAY_URL },
    // OpenAI reasoning models (e.g. gpt-5-mini) think before the first
    // visible word; at the default effort the first word took ~7 s, over the
    // 5 s the chat allows. LangChain only sends the effort for bare `gpt-5`
    // ids, so pass it through as is; other vendors would reject it.
    modelKwargs: modelId.startsWith("openai/gpt-5")
      ? { reasoning_effort: "minimal" }
      : undefined,
  });
}

/** The embedding model EMBEDDING_MODEL names. */
export function embeddings(): EmbeddingModel {
  const modelId = env("EMBEDDING_MODEL") ?? "openai/text-embedding-3-small";
  if (globalThis.MODEL_STUBS) return globalThis.MODEL_STUBS.embeddings(modelId);
  return new OpenAIEmbeddings({
    model: modelId,
    apiKey: process.env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: AI_GATEWAY_URL },
  });
}

// An unset or blank variable is no setting.
function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Jev, TypeSafe's System One model, as the chat uses it. */
export type SystemOne = Pick<TypeSafeClient, "systemOne">;

declare global {
  // Set by the test stub before the app loads, in place of the real client.
  var SYSTEM_ONE_CLIENT: SystemOne | undefined;
}

let client: { apiKey: string; jev: SystemOne } | undefined;

/**
 * Jev, or undefined without JEV_API_KEY (callers then go on without it).
 * Like the models, the env is read on every call. One attempt, no retries:
 * the chat waits for Jev before it answers.
 */
export function systemOne(): SystemOne | undefined {
  if (globalThis.SYSTEM_ONE_CLIENT) return globalThis.SYSTEM_ONE_CLIENT;
  const apiKey = env("JEV_API_KEY");
  if (!apiKey) return undefined;
  if (client?.apiKey !== apiKey)
    client = {
      apiKey,
      jev: new TypeSafeClient({
        apiKey,
        retry: { maxRetries: 0 },
        // Never "debug": request bodies hold the user's question.
        logLevel: "warn",
      }),
    };
  return client.jev;
}
