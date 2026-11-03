import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { MockEmbeddingModelV4, MockProviderV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installStubModels } from "./stub-models.js";

const FIXTURES = path.join(
  import.meta.dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);
const fixture = (name: string) =>
  [readFileSync(path.join(FIXTURES, name)), name] as const;

/**
 * Loads the app fresh, as a server restart does, with the given env, and
 * returns an agent logged in as the admin.
 */
async function startServerAsAdmin(env: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { app } = await import("./app.js");
  const admin = request.agent(app);
  await admin
    .post("/api/login")
    .send({ username: "admin", password: "correct-horse" });
  return admin;
}

describe("/api/documents", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists an uploaded document with its UTF-8 filename", async () => {
    const admin = await startServerAsAdmin();

    const upload = await admin
      .post("/api/documents")
      .attach("files", Buffer.from("# 標題\n內容"), "大量交織.md");

    expect(upload.status).toBe(201);

    const list = await admin.get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ filename: "大量交織.md" }),
    );
  });

  it("rejects a file over the size limit with 413", async () => {
    const admin = await startServerAsAdmin();
    const { MAX_UPLOAD_FILE_BYTES } = await import("./app.js");

    const res = await admin
      .post("/api/documents")
      .attach("files", Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1), "big.md");

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: expect.stringContaining("at most") as string,
    });
  });

  it("rejects more files than the limit with 400", async () => {
    const admin = await startServerAsAdmin();
    const { MAX_UPLOAD_FILES } = await import("./app.js");

    let req = admin.post("/api/documents");
    for (let i = 0; i <= MAX_UPLOAD_FILES; i++) {
      req = req.attach("files", Buffer.from("x"), `f${i}.md`);
    }
    const res = await req;

    expect(res.status).toBe(400);
  });

  it("keeps documents and chunks across a restart", async () => {
    let admin = await startServerAsAdmin();
    const upload = await admin
      .post("/api/documents")
      .attach("files", ...fixture("05-projects-and-practice.md"));
    const [doc] = upload.body as { id: string; chunkCount: number }[];
    expect(doc.chunkCount).toBe(13);

    admin = await startServerAsAdmin();

    const list = await admin.get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ id: doc.id, chunkCount: 13 }),
    );
    const chunks = await admin.get(`/api/documents/${doc.id}/chunks`);
    expect(chunks.body).toHaveLength(13);
  });

  it("re-embeds every chunk when EMBEDDING_MODEL changes", async () => {
    let admin = await startServerAsAdmin({ EMBEDDING_MODEL: "test/model-a" });
    const upload = await admin
      .post("/api/documents")
      .attach("files", ...fixture("05-projects-and-practice.md"));
    const [doc] = upload.body as { id: string }[];

    const embedded = installStubModels();
    admin = await startServerAsAdmin({ EMBEDDING_MODEL: "test/model-b" });

    const list = await admin.get("/api/documents");
    const total = (list.body as { chunkCount: number }[]).reduce(
      (sum, d) => sum + d.chunkCount,
      0,
    );
    expect(embedded["test/model-b"]).toHaveLength(total);
    const chunks = await admin.get(`/api/documents/${doc.id}/chunks`);
    for (const chunk of chunks.body as { embeddingModel: string }[])
      expect(chunk.embeddingModel).toBe("test/model-b");
  });

  it("stores none of the files when embedding one of them fails", async () => {
    const admin = await startServerAsAdmin();
    const failing = new MockProviderV4();
    failing.embeddingModel = (modelId: string) =>
      new MockEmbeddingModelV4({
        modelId,
        maxEmbeddingsPerCall: 2048,
        doEmbed: ({ values }) =>
          values.some((v) => v.includes("05-projects"))
            ? Promise.reject(new Error("gateway down"))
            : Promise.resolve({
                embeddings: values.map(() => [1, 0]),
                warnings: [],
              }),
      });
    globalThis.AI_SDK_DEFAULT_PROVIDER = failing;

    const res = await admin
      .post("/api/documents")
      .attach("files", ...fixture("01-overview.md"))
      .attach("files", ...fixture("05-projects-and-practice.md"));
    installStubModels();

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: expect.any(String) as string });
    const list = await admin.get("/api/documents");
    expect(list.body).not.toContainEqual(
      expect.objectContaining({ filename: "01-overview.md" }),
    );
  });

  it("returns 404 for the chunks of an unknown document", async () => {
    const admin = await startServerAsAdmin();
    const res = await admin.get("/api/documents/nope/chunks");
    expect(res.status).toBe(404);
  });
});
