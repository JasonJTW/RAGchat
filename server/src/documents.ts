import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embed as embedOne, embedMany } from "ai";
import { getEncoding } from "js-tiktoken";
import { hybridSearch } from "./hybrid-search.js";
import { chunkMarkdown, type MarkdownChunk } from "./markdown-chunks.js";
import { EMBEDDING_MODEL } from "./models.js";

// The document store: uploaded files, their chunks and embeddings, kept in
// memory and persisted as one JSON file under DATA_DIR (default server/data/).
// Swapping in a vector database later only touches this module.

/** An uploaded document as listed in the admin. */
export interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

/** A chunk as shown under 查看段落 in the admin. */
export interface ChunkSummary {
  /** [filename, H1, H2, H3] */
  path: string[];
  /** The first 80 characters of the chunk's content. */
  preview: string;
  /** The embedding model id that produced the chunk's vector. */
  embeddingModel: string;
}

/** A chunk retrieved for a question, as cited under an answer. */
export interface Passage {
  id: string;
  /** e.g. "05-projects-and-practice.md › 05 實踐案例 … › C. 移動微型空間計畫" */
  label: string;
  /** The chunk's original text, shown when the citation is expanded. */
  text: string;
}

interface StoredChunk extends MarkdownChunk {
  embedding: number[];
  embeddingModel: string;
}

interface StoredDocument {
  id: string;
  filename: string;
  uploadedAt: string;
  /** The uploaded file, base64. */
  source: string;
  chunks: StoredChunk[];
}

const dataDir =
  process.env.DATA_DIR || fileURLToPath(new URL("../data/", import.meta.url));
const storeFile = path.join(dataDir, "documents.json");
const encoding = getEncoding("cl100k_base");
const countTokens = (text: string) => encoding.encode(text).length;

const documents: StoredDocument[] = load();
await reembedStaleChunks();

export function listDocuments(): DocumentSummary[] {
  return documents.map((doc) => ({
    id: doc.id,
    filename: doc.filename,
    chunkCount: doc.chunks.length,
    uploadedAt: doc.uploadedAt,
  }));
}

/** The document's chunks, or undefined when no document has that id. */
export function listChunks(id: string): ChunkSummary[] | undefined {
  return documents
    .find((doc) => doc.id === id)
    ?.chunks.map((chunk) => ({
      path: chunk.path,
      preview: Array.from(chunk.content).slice(0, 80).join(""),
      embeddingModel: chunk.embeddingModel,
    }));
}

/** The chunks that best match the question, best first. */
export async function retrieve(
  question: string,
  limit: number,
): Promise<Passage[]> {
  const chunks = documents.flatMap((doc) =>
    doc.chunks.map((chunk, i) => ({ doc, chunk, i })),
  );
  if (chunks.length === 0) return [];
  const { embedding } = await embedOne({
    model: EMBEDDING_MODEL,
    value: question,
  });
  const ranked = hybridSearch(
    chunks.map(({ chunk }) => ({
      text: chunk.embedText,
      embedding: chunk.embedding,
    })),
    question,
    embedding,
    limit,
  );
  return ranked.map((index) => {
    const { doc, chunk, i } = chunks[index];
    return {
      id: `${doc.id}:${i}`,
      label: chunk.path.join(" › "),
      text: chunk.content,
    };
  });
}

/**
 * Chunks and embeds every file, then stores them all at once. Resolves once
 * they are saved; if embedding or saving fails, rejects and stores none.
 */
export async function addDocuments(
  files: { filename: string; bytes: Buffer }[],
): Promise<DocumentSummary[]> {
  const added: StoredDocument[] = [];
  for (const { filename, bytes } of files) {
    const chunks = filename.toLowerCase().endsWith(".md")
      ? chunkMarkdown(filename, bytes.toString("utf8"), countTokens)
      : [];
    added.push({
      id: randomUUID(),
      filename,
      uploadedAt: new Date().toISOString(),
      source: bytes.toString("base64"),
      chunks: await embed(chunks),
    });
  }
  documents.push(...added);
  try {
    save();
  } catch (error) {
    documents.splice(documents.length - added.length); // nothing stays half-added
    throw error;
  }
  const ids = new Set(added.map((doc) => doc.id));
  return listDocuments().filter((summary) => ids.has(summary.id));
}

async function embed(chunks: MarkdownChunk[]): Promise<StoredChunk[]> {
  if (chunks.length === 0) return [];
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: chunks.map((chunk) => chunk.embedText),
  });
  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: embeddings[i],
    embeddingModel: EMBEDDING_MODEL,
  }));
}

// Vectors from different models can't be compared, so a changed
// EMBEDDING_MODEL re-embeds every chunk at startup.
async function reembedStaleChunks() {
  const stale = documents.filter((doc) =>
    doc.chunks.some((chunk) => chunk.embeddingModel !== EMBEDDING_MODEL),
  );
  if (stale.length === 0) return;
  for (const doc of stale) doc.chunks = await embed(doc.chunks);
  save();
}

function load(): StoredDocument[] {
  try {
    return (
      JSON.parse(readFileSync(storeFile, "utf8")) as {
        documents: StoredDocument[];
      }
    ).documents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function save() {
  mkdirSync(dataDir, { recursive: true });
  // Write then rename, so a crash mid-write never leaves half a file.
  const tmp = `${storeFile}.tmp`;
  writeFileSync(tmp, JSON.stringify({ documents }));
  renameSync(tmp, storeFile);
}
