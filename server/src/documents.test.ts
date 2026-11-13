import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubSession } from "./stub-auth.js";
import { installStubModels } from "./stub-models.js";

const FIXTURES = path.join(
  import.meta.dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);
const fixture = (name: string) =>
  [readFileSync(path.join(FIXTURES, name)), name] as const;

/**
 * Loads the app fresh, as a server restart does, with the given env, and
 * returns an agent signed in as a 成員.
 */
async function startServerAsMember(env: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { app } = await import("./app.js");
  return request.agent(app).set("Cookie", stubSession("user_member", "member"));
}

describe("/api/documents", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists an uploaded document with its UTF-8 filename", async () => {
    const member = await startServerAsMember();

    const upload = await member
      .post("/api/documents")
      .attach("files", Buffer.from("# 標題\n內容"), "大量交織.md");

    expect(upload.status).toBe(201);

    const list = await member.get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ filename: "大量交織.md" }),
    );
  });

  it("rejects a file over the size limit with 413", async () => {
    const member = await startServerAsMember();
    const { MAX_UPLOAD_FILE_BYTES } = await import("./app.js");

    const res = await member
      .post("/api/documents")
      .attach("files", Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1), "big.md");

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: expect.stringContaining("at most") as string,
    });
  });

  it("rejects more files than the limit with 400", async () => {
    const member = await startServerAsMember();
    const { MAX_UPLOAD_FILES } = await import("./app.js");

    let req = member.post("/api/documents");
    for (let i = 0; i <= MAX_UPLOAD_FILES; i++) {
      req = req.attach("files", Buffer.from("x"), `f${i}.md`);
    }
    const res = await req;

    expect(res.status).toBe(400);
  });

  it("keeps documents and chunks across a restart", async () => {
    let member = await startServerAsMember();
    const upload = await member
      .post("/api/documents")
      .attach("files", ...fixture("05-projects-and-practice.md"));
    const [doc] = upload.body as { id: string; chunkCount: number }[];
    expect(doc.chunkCount).toBe(13);

    member = await startServerAsMember();

    const list = await member.get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ id: doc.id, chunkCount: 13 }),
    );
    const chunks = await member.get(`/api/documents/${doc.id}/chunks`);
    expect(chunks.body).toHaveLength(13);
  });

  it("keeps a deleted document deleted across a restart", async () => {
    let member = await startServerAsMember();
    const upload = await member
      .post("/api/documents")
      .attach("files", ...fixture("05-projects-and-practice.md"));
    const [doc] = upload.body as { id: string }[];

    const res = await member.delete(`/api/documents/${doc.id}`);
    expect(res.status).toBe(204);
    member = await startServerAsMember();

    const list = await member.get("/api/documents");
    expect(list.body).not.toContainEqual(
      expect.objectContaining({ id: doc.id }),
    );
    const chunks = await member.get(`/api/documents/${doc.id}/chunks`);
    expect(chunks.status).toBe(404);
  });

  it("returns 404 when deleting an unknown document", async () => {
    const member = await startServerAsMember();
    const res = await member.delete("/api/documents/nope");
    expect(res.status).toBe(404);
  });

  it("re-embeds every chunk when EMBEDDING_MODEL changes", async () => {
    let member = await startServerAsMember({ EMBEDDING_MODEL: "test/model-a" });
    const upload = await member
      .post("/api/documents")
      .attach("files", ...fixture("05-projects-and-practice.md"));
    const [doc] = upload.body as { id: string }[];

    const { embedded } = installStubModels();
    member = await startServerAsMember({ EMBEDDING_MODEL: "test/model-b" });

    const list = await member.get("/api/documents");
    const total = (list.body as { chunkCount: number }[]).reduce(
      (sum, d) => sum + d.chunkCount,
      0,
    );
    expect(embedded["test/model-b"]).toHaveLength(total);
    const chunks = await member.get(`/api/documents/${doc.id}/chunks`);
    for (const chunk of chunks.body as { embeddingModel: string }[])
      expect(chunk.embeddingModel).toBe("test/model-b");
  });

  it("stores none of the files when embedding one of them fails", async () => {
    const member = await startServerAsMember();
    const stubs = globalThis.MODEL_STUBS!;
    globalThis.MODEL_STUBS = {
      ...stubs,
      embeddings: (modelId) => {
        const model = stubs.embeddings(modelId);
        const embedDocuments = model.embedDocuments.bind(model);
        model.embedDocuments = (texts) =>
          texts.some((text) => text.includes("05-projects"))
            ? Promise.reject(new Error("gateway down"))
            : embedDocuments(texts);
        return model;
      },
    };

    const res = await member
      .post("/api/documents")
      .attach("files", ...fixture("01-overview.md"))
      .attach("files", ...fixture("05-projects-and-practice.md"));
    installStubModels();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: expect.any(String) as string });
    const list = await member.get("/api/documents");
    expect(list.body).not.toContainEqual(
      expect.objectContaining({ filename: "01-overview.md" }),
    );
  });

  it("stores none of the files when saving them fails", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "kb-readonly-"));
    const member = await startServerAsMember({ DATA_DIR: dataDir });
    chmodSync(dataDir, 0o500); // the store file can't be written
    try {
      const res = await member
        .post("/api/documents")
        .attach("files", ...fixture("01-overview.md"));

      expect(res.status).toBe(500);
      const list = await member.get("/api/documents");
      expect(list.body).toEqual([]);
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it("returns 404 for the chunks of an unknown document", async () => {
    const member = await startServerAsMember();
    const res = await member.get("/api/documents/nope/chunks");
    expect(res.status).toBe(404);
  });
});
