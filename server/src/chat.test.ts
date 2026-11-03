import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("POST /api/chat", () => {
  it("streams an answer and a citation as a UI message stream", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send({ messages: [] })
      .buffer(true)
      .parse((r, done) => {
        let body = "";
        r.on("data", (chunk: Buffer) => (body += chunk.toString()));
        r.on("end", () => done(null, body));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain('"type":"text-delta"');
    expect(res.body).toContain('"type":"data-citation"');
  });
});
