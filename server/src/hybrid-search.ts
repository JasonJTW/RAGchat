// Hybrid retrieval: embedding cosine top 20 plus BM25 top 20 (Chinese as
// character bigrams), merged by reciprocal rank fusion. Pure.

const CANDIDATES = 20; // from each ranking
const RRF_K = 60;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export interface Searchable {
  /** Indexed by BM25. */
  text: string;
  embedding: number[];
}

/**
 * Indexes into `items` of the best `limit` matches, best first, and the
 * highest cosine similarity of any item to the query (0 when there are none).
 * RRF scores only reflect rank, so the similarity is what says how well the
 * best match fits.
 */
export function hybridSearch(
  items: Searchable[],
  query: string,
  queryVector: number[],
  limit: number,
): { ranked: number[]; similarity: number } {
  const similarities = items.map((item) => cosine(item.embedding, queryVector));
  const fused = new Map<number, number>();
  for (const ranking of [top(similarities), top(bm25(items, query))])
    ranking.forEach((index, rank) =>
      fused.set(index, (fused.get(index) ?? 0) + 1 / (RRF_K + rank + 1)),
    );
  return {
    ranked: [...fused]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([index]) => index),
    similarity: Math.max(0, ...similarities),
  };
}

function top(scores: number[]): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES)
    .map(({ index }) => index);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

function bm25(items: Searchable[], query: string): number[] {
  const docs = items.map((item) => tokenize(item.text));
  const avgLength =
    docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  const docFrequency = new Map<string, number>();
  for (const doc of docs)
    for (const term of new Set(doc))
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  const terms = new Set(tokenize(query));
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const n = docFrequency.get(term)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score +=
        (idf * f * (BM25_K1 + 1)) /
        (f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / avgLength));
    }
    return score;
  });
}

// CJK runs become character bigrams (a lone character stays a unigram);
// letter and digit runs become lowercase words.
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const [run] of text.matchAll(
    /\p{Script=Han}+|[\p{Script=Latin}\p{Nd}]+/gu,
  )) {
    if (!/\p{Script=Han}/u.test(run)) {
      tokens.push(run.toLowerCase());
      continue;
    }
    const chars = Array.from(run);
    if (chars.length === 1) tokens.push(run);
    for (let i = 0; i < chars.length - 1; i++)
      tokens.push(chars[i] + chars[i + 1]);
  }
  return tokens;
}
