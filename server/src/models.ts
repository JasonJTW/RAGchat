// Model ids are `<provider>/<model>` strings resolved by the AI SDK's default
// provider (Vercel AI Gateway). Read from the environment once, at startup.

export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
