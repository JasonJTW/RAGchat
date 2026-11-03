import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Citation } from "./chat.js";
import { installStubModels } from "./stub-models.js";

const FIXTURES = path.join(
  import.meta.dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

/** Starts the app fresh with only 05-projects-and-practice.md uploaded. */
async function startServerWithUpload() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(tmpdir(), "kb-chat-test-")));
  vi.resetModules();
  const { app } = await import("./app.js");
  const admin = request.agent(app);
  await admin
    .post("/api/login")
    .send({ username: "admin", password: "correct-horse" });
  const name = "05-projects-and-practice.md";
  await admin
    .post("/api/documents")
    .attach("files", readFileSync(path.join(FIXTURES, name)), name);
  return app;
}

/** Asks one question and returns the UI message stream's parts. */
async function ask(app: Parameters<typeof request>[0], question: string) {
  const res = await request(app)
    .post("/api/chat")
    .send({
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: question }] },
      ],
    })
    .buffer(true)
    .parse((r, done) => {
      let body = "";
      r.on("data", (chunk: Buffer) => (body += chunk.toString()));
      r.on("end", () => done(null, body));
    });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/event-stream");
  return (res.body as string)
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map(
      (line) =>
        JSON.parse(line.slice("data: ".length)) as {
          type: string;
          delta?: string;
          data?: Citation;
        },
    );
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD", "correct-horse");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a body without a messages array with 400", async () => {
    vi.resetModules();
    const { app } = await import("./app.js");
    const res = await request(app).post("/api/chat").send({ question: "hi" });
    expect(res.status).toBe(400);
  });

  it("streams the model's answer", async () => {
    const { chat } = installStubModels();
    chat.reply = "旅梯計畫巡迴了 5 站。[1]";
    const app = await startServerWithUpload();

    const parts = await ask(app, "旅梯計畫總共巡迴了幾站？");

    const deltas = parts.filter((p) => p.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((p) => p.delta).join("")).toBe(chat.reply);
  });

  it("cites only the passages the answer marks, as numbered in the prompt", async () => {
    const { chat } = installStubModels();
    chat.reply = "旅梯計畫巡迴了 5 站。[2]";
    const app = await startServerWithUpload();

    const parts = await ask(app, "旅梯計畫總共巡迴了幾站？是哪幾年？");

    const citations = parts.flatMap((p) =>
      p.type === "data-citation" && p.data ? [p.data] : [],
    );
    expect(citations).toHaveLength(1);
    const [citation] = citations;
    expect(citation.marker).toBe(2);
    expect(citation.label).toMatch(/^05-projects-and-practice\.md › /);
    // The cited text is the second passage the model was given.
    const [prompt] = chat.prompts;
    const at = prompt.indexOf(citation.text);
    expect(at).toBeGreaterThan(prompt.indexOf("[2]"));
    expect(at).toBeLessThan(prompt.indexOf("[3]"));
  });

  it("refuses without calling the model when no passage is similar enough", async () => {
    const { chat, vectors } = installStubModels();
    const question = "我的帳號被停權了，要怎麼申訴？";
    // Points away from every stored passage: similarity below the threshold.
    vectors.set(question, new Array<number>(64).fill(-1));
    const app = await startServerWithUpload();

    const parts = await ask(app, question);

    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => p.delta)
      .join("");
    expect(text).toContain("這個問題我無法回答");
    expect(text).toContain("support@megaweaving.example");
    expect(parts.some((p) => p.type === "data-citation")).toBe(false);
    expect(chat.prompts).toHaveLength(0);
  });

  it("cites nothing when the model refuses", async () => {
    const { chat } = installStubModels();
    chat.reply =
      "這個問題我無法回答，請來信客服 support@megaweaving.example。[1]";
    const app = await startServerWithUpload();

    const parts = await ask(app, "旅梯計畫的贊助商是誰？");

    expect(chat.prompts).toHaveLength(1);
    expect(parts.some((p) => p.type === "data-citation")).toBe(false);
  });

  it("tells the model the refusal sentence for questions the passages don't answer", async () => {
    const { chat } = installStubModels();
    const app = await startServerWithUpload();

    await ask(app, "旅梯計畫總共巡迴了幾站？");

    expect(chat.prompts[0]).toContain(
      "這個問題我無法回答，請來信客服 support@megaweaving.example。",
    );
  });

  it("gives the model the passages that match the question", async () => {
    const { chat } = installStubModels();
    const app = await startServerWithUpload();

    await ask(app, "旅梯計畫總共巡迴了幾站？是哪幾年？");

    expect(chat.prompts[0]).toContain("C. 移動微型空間計畫");
    expect(chat.prompts[0]).toContain("旅梯計畫總共巡迴了幾站？是哪幾年？");
  });
});
