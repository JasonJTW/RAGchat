import { TypeSafeClient } from "@typesafe-ai/sdk";

// Model ids are `<provider>/<model>` strings resolved by the AI SDK's default
// provider (Vercel AI Gateway). Read from the environment once, at startup.

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";

export const CHAT_MODEL = process.env.CHAT_MODEL || "openai/gpt-5-mini";

// Reasoning models (e.g. gpt-5-mini) think before the first visible word; at
// the default effort the first word took ~7 s, over the 5 s the chat allows.
// Other providers ignore the `openai` key.
export const CHAT_PROVIDER_OPTIONS = {
  openai: { reasoningEffort: "minimal" },
};

/** Jev, TypeSafe's System One model, as the chat uses it. */
export type SystemOne = Pick<TypeSafeClient, "systemOne">;

declare global {
  // Set by the test stub before the app loads, in place of the real client.
  var SYSTEM_ONE_CLIENT: SystemOne | undefined;
}

// Without JEV_API_KEY there is no client, and callers go on without Jev.
// One attempt, no retries: the chat waits for Jev before it answers.
export const SYSTEM_ONE: SystemOne | undefined =
  globalThis.SYSTEM_ONE_CLIENT ??
  (process.env.JEV_API_KEY
    ? new TypeSafeClient({
        apiKey: process.env.JEV_API_KEY,
        retry: { maxRetries: 0 },
        // Never "debug": request bodies hold the user's question.
        logLevel: "warn",
      })
    : undefined);
