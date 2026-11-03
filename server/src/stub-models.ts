import { MockEmbeddingModelV4, MockProviderV4 } from "ai/test";

/**
 * Replaces the AI Gateway with a fake provider: any embedding model id returns
 * fixed vectors derived from the text and the id, without a network call.
 * Returns the texts each model id was asked to embed.
 */
export function installStubModels(): Record<string, string[]> {
  const embedded: Record<string, string[]> = {};
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
  globalThis.AI_SDK_DEFAULT_PROVIDER = provider;
  return embedded;
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
