import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, MAX_UPLOAD_FILES, MAX_UPLOAD_FILE_BYTES } from "./app.js";

async function loggedInAdmin() {
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
    const admin = await loggedInAdmin();

    const upload = await admin
      .post("/api/documents")
      .attach("files", Buffer.from("# 標題\n內容"), "大量交織.md");

    expect(upload.status).toBe(201);

    const list = await admin.get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ filename: "大量交織.md", chunkCount: 0 }),
    );
  });

  it("rejects a file over the size limit with 413", async () => {
    const admin = await loggedInAdmin();

    const res = await admin
      .post("/api/documents")
      .attach("files", Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1), "big.md");

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: expect.stringContaining("at most") as string,
    });
  });

  it("rejects more files than the limit with 400", async () => {
    const admin = await loggedInAdmin();

    let req = admin.post("/api/documents");
    for (let i = 0; i <= MAX_UPLOAD_FILES; i++) {
      req = req.attach("files", Buffer.from("x"), `f${i}.md`);
    }
    const res = await req;

    expect(res.status).toBe(400);
  });
});
