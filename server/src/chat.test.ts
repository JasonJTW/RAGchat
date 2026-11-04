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

type ChatTurn = { role: "user" | "assistant"; text: string };

/**
 * Asks the question after the earlier turns of the same conversation, and
 * returns the UI message stream's parts.
 */
async function ask(
  app: Parameters<typeof request>[0],
  question: string,
  history: ChatTurn[] = [],
) {
  const res = await request(app)
    .post("/api/chat")
    .send({
      messages: [...history, { role: "user", text: question }].map(
        ({ role, text }, i) => ({
          id: `m${i}`,
          role,
          parts: [{ type: "text", text }],
        }),
      ),
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

  it("accepts an earlier answer over 2,000 characters in the history", async () => {
    installStubModels();
    vi.stubEnv("DATA_DIR", mkdtempSync(path.join(tmpdir(), "kb-chat-test-")));
    vi.resetModules();
    const { app } = await import("./app.js");
    const res = await request(app)
      .post("/api/chat")
      .send({
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
          {
            id: "a1",
            role: "assistant",
            parts: [{ type: "text", text: "答".repeat(3000) }],
          },
          { id: "u2", role: "user", parts: [{ type: "text", text: "再說" }] },
        ],
      });
    expect(res.status).toBe(200);
  });

  it.each([
    ["a null message", [null]],
    ["a null part", [{ id: "u1", role: "user", parts: [null] }]],
    [
      "a non-string text",
      [{ id: "u1", role: "user", parts: [{ type: "text", text: 42 }] }],
    ],
    [
      "a text over 2,000 characters",
      [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "問".repeat(2001) }],
        },
      ],
    ],
    [
      "more than 50 messages",
      Array.from({ length: 51 }, (_, i) => ({
        id: `u${i}`,
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      })),
    ],
  ])("rejects %s with 400 and no stack trace", async (_, messages) => {
    vi.resetModules();
    const { app } = await import("./app.js");
    const res = await request(app).post("/api/chat").send({ messages });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/TypeError|\n\s+at /);
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

  it("cites passages marked with full-width brackets", async () => {
    const { chat } = installStubModels();
    chat.reply =
      "旅梯計畫巡迴了 5 站。〔1〕 2017 年起跑。［2］ 起點在台新。【3】";
    const app = await startServerWithUpload();

    const parts = await ask(app, "旅梯計畫總共巡迴了幾站？是哪幾年？");

    const markers = parts.flatMap((p) =>
      p.type === "data-citation" && p.data ? [p.data.marker] : [],
    );
    expect(markers).toEqual([1, 2, 3]);
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

  describe("a first question with a pronoun", () => {
    const Q3 = "那它是哪幾年辦的？總共做了幾個案例？";
    const CLARIFY = "請問你指的是哪個計畫或主題？";
    const textOf = (parts: Awaited<ReturnType<typeof ask>>) =>
      parts
        .filter((p) => p.type === "text-delta")
        .map((p) => p.delta)
        .join("");

    it("asks which subject is meant, citing nothing, when the check finds no name", async () => {
      const { chat } = installStubModels();
      chat.verdict = "沒有";
      const app = await startServerWithUpload();

      const parts = await ask(app, Q3);

      expect(chat.verdictPrompts).toHaveLength(1);
      expect(chat.verdictPrompts[0]).toContain(Q3);
      expect(textOf(parts)).toBe(CLARIFY);
      expect(parts.some((p) => p.type === "data-citation")).toBe(false);
    });

    it("is answered as usual, with citations, when the check finds a name", async () => {
      const { chat } = installStubModels();
      chat.verdict = "有";
      chat.reply = "旅梯計畫的起點在台新。[1]";
      const app = await startServerWithUpload();

      const parts = await ask(app, "那個旅梯計畫的起點在哪裡？");

      expect(chat.verdictPrompts).toHaveLength(1);
      expect(textOf(parts)).toBe("旅梯計畫的起點在台新。[1]");
      expect(parts.filter((p) => p.type === "data-citation")).toHaveLength(1);
    });

    it("is not checked when it has no pointing word", async () => {
      const { chat } = installStubModels();
      chat.verdict = "沒有";
      chat.reply = "旅梯計畫巡迴了 5 站。[1]";
      const app = await startServerWithUpload();

      const parts = await ask(app, "旅梯計畫總共巡迴了幾站？是哪幾年？");

      expect(chat.verdictPrompts).toHaveLength(0);
      expect(textOf(parts)).toBe("旅梯計畫巡迴了 5 站。[1]");
    });

    it("is not checked as a follow-up", async () => {
      const { chat } = installStubModels();
      chat.verdict = "沒有";
      chat.reply = "2008 到 2012 年，20 多個案例。[1]";
      const app = await startServerWithUpload();

      const parts = await ask(app, Q3, [
        {
          role: "user",
          text: "一百元的大直社區改造計畫，每個學生最多可以花多少錢？",
        },
        { role: "assistant", text: "每人上限新台幣 100 元。[1]" },
      ]);

      expect(chat.verdictPrompts).toHaveLength(0);
      expect(textOf(parts)).toBe("2008 到 2012 年，20 多個案例。[1]");
    });
  });

  describe("a follow-up question", () => {
    const Q2 = "一百元的大直社區改造計畫，每個學生最多可以花多少錢？";
    const A2 = "每人上限新台幣 100 元，以廢料為主要材料。[1]";
    const Q3 = "那它是哪幾年辦的？總共做了幾個案例？";
    const STANDALONE =
      "一百元的大直社區改造計畫是哪幾年辦的？總共做了幾個案例？";

    it("is retrieved as the standalone question the model rewrites it to", async () => {
      const { chat, embedded } = installStubModels();
      chat.rewrite = STANDALONE;
      const app = await startServerWithUpload();

      await ask(app, Q3, [
        { role: "user", text: Q2 },
        { role: "assistant", text: A2 },
      ]);

      // The rewrite sees the conversation and the new question.
      expect(chat.rewritePrompts).toHaveLength(1);
      expect(chat.rewritePrompts[0]).toContain(Q2);
      expect(chat.rewritePrompts[0]).toContain(A2);
      expect(chat.rewritePrompts[0]).toContain(Q3);
      // Retrieval embeds the rewritten question, not the one asked.
      const queries = embedded["openai/text-embedding-3-small"];
      expect(queries.at(-1)).toBe(STANDALONE);
      expect(queries).not.toContain(Q3);
    });

    it("is answered with the conversation so far", async () => {
      const { chat } = installStubModels();
      chat.rewrite = STANDALONE;
      const app = await startServerWithUpload();

      await ask(app, Q3, [
        { role: "user", text: Q2 },
        { role: "assistant", text: A2 },
      ]);

      expect(chat.prompts).toHaveLength(1);
      expect(chat.prompts[0]).toContain(Q2);
      expect(chat.prompts[0]).toContain(A2);
      expect(chat.prompts[0]).toContain(Q3);
    });

    it("is not rewritten when it opens the conversation", async () => {
      const { chat, embedded } = installStubModels();
      const app = await startServerWithUpload();

      await ask(app, Q2);

      expect(chat.rewritePrompts).toHaveLength(0);
      expect(embedded["openai/text-embedding-3-small"].at(-1)).toBe(Q2);
    });
  });
});
