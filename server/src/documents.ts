import { randomUUID } from "node:crypto";

/** An uploaded document as listed in the admin. */
export interface DocumentSummary {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

// Walking skeleton: documents live in memory and are not chunked yet.
const documents: DocumentSummary[] = [];

export function listDocuments(): DocumentSummary[] {
  return documents;
}

export function addDocument(filename: string): DocumentSummary {
  const doc: DocumentSummary = {
    id: randomUUID(),
    filename,
    chunkCount: 0,
    uploadedAt: new Date().toISOString(),
  };
  documents.push(doc);
  return doc;
}
