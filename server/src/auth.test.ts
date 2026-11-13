import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";
import { stubSession } from "./stub-auth.js";

// Every server test runs with stub sign-in (vitest.setup.ts): a request
// carries the stub session cookie of a 成員 or a 訪客, or none.
const member = stubSession("user_member", "member");
const guest = stubSession("user_guest", "guest");

const ID = "00000000-0000-0000-0000-000000000000";
const knowledgeBaseCalls = {
  chat: () => request(app).post("/api/chat").send({ messages: [] }),
  confirm: () => request(app).post(`/api/proposals/${ID}/confirm`),
  reject: () => request(app).post(`/api/proposals/${ID}/reject`),
  "list documents": () => request(app).get("/api/documents"),
  upload: () =>
    request(app)
      .post("/api/documents")
      .attach("files", Buffer.from("內容"), "faq.txt"),
  "delete document": () => request(app).delete("/api/documents/x"),
  chunks: () => request(app).get("/api/documents/x/chunks"),
};

describe("a caller who is not signed in", () => {
  it("gets 401 from every knowledge base API", async () => {
    for (const [name, call] of Object.entries(knowledgeBaseCalls)) {
      const res = await call();
      expect(res.status, name).toBe(401);
    }
  });

  it("gets 401 from /api/me", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("gets 401 with a malformed stub session", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Cookie", "stub_session=nonsense");
    expect(res.status).toBe(401);
  });
});

describe("a signed-in user outside the MegaWeaving Organization (訪客)", () => {
  it("gets 403 from every knowledge base API of the team workspace", async () => {
    for (const [name, call] of Object.entries(knowledgeBaseCalls)) {
      const res = await call().set("Cookie", guest);
      expect(res.status, name).toBe(403);
      expect(res.body).toEqual({ error: "guest trials are not open yet" });
    }
  });

  it("is told by /api/me that they are a guest", async () => {
    const res = await request(app).get("/api/me").set("Cookie", guest);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "user_guest", role: "guest" });
  });
});

describe("a 成員", () => {
  it("is told by /api/me that they are a member", async () => {
    const res = await request(app).get("/api/me").set("Cookie", member);
    expect(res.body).toEqual({ userId: "user_member", role: "member" });
  });

  it("reaches the knowledge base APIs", async () => {
    const chat = await request(app)
      .post("/api/chat")
      .set("Cookie", member)
      .send({ messages: [] });
    expect(chat.status).toBe(200);
    const unknown = await request(app)
      .post(`/api/proposals/${ID}/confirm`)
      .set("Cookie", member);
    expect(unknown.status).toBe(404);
    expect(
      (await request(app).get("/api/documents").set("Cookie", member)).status,
    ).toBe(200);
  });
});

describe("the old admin login", () => {
  it("is gone", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "x" });
    expect(res.status).toBe(404);
  });
});
