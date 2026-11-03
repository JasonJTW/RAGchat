import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.js";

describe("admin API without a session", () => {
  it("refuses to list documents", async () => {
    const res = await request(app).get("/api/documents");

    expect(res.status).toBe(401);
  });

  it("refuses to upload documents", async () => {
    const res = await request(app)
      .post("/api/documents")
      .attach("files", Buffer.from("內容"), "faq.txt");

    expect(res.status).toBe(401);
  });

  it("still answers chat", async () => {
    const res = await request(app).post("/api/chat").send({ messages: [] });

    expect(res.status).toBe(200);
  });
});

describe("POST /api/login", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_USERNAME", "admin");
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens the admin API with the right credentials", async () => {
    const agent = request.agent(app);

    const login = await agent
      .post("/api/login")
      .send({ username: "admin", password: "correct-horse" });

    expect(login.status).toBe(204);
    expect(login.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/i);
    expect((await agent.get("/api/documents")).status).toBe(200);
  });

  it("rejects a wrong password", async () => {
    const agent = request.agent(app);

    const login = await agent
      .post("/api/login")
      .send({ username: "admin", password: "wrong" });

    expect(login.status).toBe(401);
    expect(login.headers["set-cookie"]).toBeUndefined();
    expect((await agent.get("/api/documents")).status).toBe(401);
  });

  it("defaults the username to admin", async () => {
    vi.stubEnv("ADMIN_USERNAME", undefined);

    const login = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "correct-horse" });

    expect(login.status).toBe(204);
  });

  it("rejects a body without a password as malformed", async () => {
    const login = await request(app)
      .post("/api/login")
      .send({ username: "admin" });

    expect(login.status).toBe(400);
  });

  it("lets nobody in while ADMIN_PASSWORD is unset, and says so", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");

    const login = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "" });

    expect(login.status).toBe(503);
    expect(login.headers["set-cookie"]).toBeUndefined();
    expect(login.body).toEqual({ error: "ADMIN_PASSWORD is not set" });
  });
});
