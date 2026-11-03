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
