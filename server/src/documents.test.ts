import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("/api/documents", () => {
  it("lists an uploaded document with its UTF-8 filename", async () => {
    const upload = await request(app)
      .post("/api/documents")
      .attach("files", Buffer.from("# 標題\n內容"), "大量交織.md");

    expect(upload.status).toBe(201);

    const list = await request(app).get("/api/documents");
    expect(list.body).toContainEqual(
      expect.objectContaining({ filename: "大量交織.md", chunkCount: 0 }),
    );
  });
});
