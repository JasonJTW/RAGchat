import { sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Citation } from "./chat.js";
import { db } from "./db.js";
import type { Proposal } from "./knowledge-base.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace, type Caller } from "./workspaces.js";

// 去識別 through the API (ADR-0004, spec's 敏感內容 stories): what reaches the
// models and the tables holds pseudonyms only; what a 成員 gets back holds
// the real values; an input with a secret stores nothing. Each test is a
// 成員 in a team workspace of its own, on the local analyzer (vitest.setup).
const caller = vi.hoisted(() => ({ current: undefined as unknown as Caller }));
vi.mock("./workspaces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaces.js")>()),
  callerOf: () => Promise.resolve(caller.current),
}));
const { app } = await import("./app.js");

interface Part {
  type: string;
  id?: string;
  delta?: string;
  data?: unknown;
}

// The detected values in INPUT, and what they become.
const INPUT =
  "請把以下內容輸入到知識庫：王小明先生負責倉庫盤點。王小明的手機是 0912-345-678。月預算 3 萬元。";
const REAL = ["王小明", "0912-345-678", "3 萬元"];

let stubs: ReturnType<typeof installStubModels>;

beforeEach(async () => {
  stubs = installStubModels();
  caller.current = {
    workspaceId: await createWorkspace("team", "test"),
    userId: "member-a",
    role: "member",
  };
});

async function chat(
  messages: { role: string; parts: object[] }[],
  id?: string,
): Promise<Part[]> {
  const res = await request(app)
    .post("/api/chat")
    .send({ ...(id && { id }), messages })
    .buffer(true)
    .parse((r, done) => {
      let body = "";
      r.on("data", (chunk: Buffer) => (body += chunk.toString()));
      r.on("end", () => done(null, body));
    });
  expect(res.status).toBe(200);
  return (res.body as string)
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Part);
}

const say = (text: string, parts: object[] = [], id?: string) =>
  chat([{ role: "user", parts: [{ type: "text", text }, ...parts] }], id);

const textOf = (parts: Part[]) =>
  parts.flatMap((p) => (p.type === "text-delta" ? [p.delta] : [])).join("");
const cardsOf = (parts: Part[]) =>
  parts.flatMap((p) =>
    p.type === "data-proposal" ? [p.data as Proposal] : [],
  );
const citationsOf = (parts: Part[]) =>
  parts.flatMap((p) =>
    p.type === "data-citation" ? [p.data as Citation] : [],
  );

function filePart(filename: string, text: string) {
  return {
    type: "file",
    mediaType: "text/plain",
    filename,
    url: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
  };
}

// Every row the workspace has in the tables that hold its knowledge base.
async function dump(): Promise<string> {
  const ws = caller.current.workspaceId;
  const tables = [
    "sources",
    "source_chunks",
    "facts",
    "proposals",
    "proposal_items",
    "conversations",
    "pseudonyms",
    "entities",
    "entity_aliases",
    "edges",
  ];
  const rows = await Promise.all(
    tables.map((table) =>
      db.execute(
        sql`select row_to_json(t) as row from ${sql.identifier(table)} t where workspace_id = ${ws}`,
      ),
    ),
  );
  return JSON.stringify(rows.map((r) => r.rows));
}

const NOTHING = JSON.stringify(Array.from({ length: 10 }, () => []));

// Everything the models were sent: prompts and texts to embed.
const modelInput = () =>
  JSON.stringify([
    stubs.chat.prompts,
    stubs.chat.structuredPrompts,
    stubs.chat.rewritePrompts,
    stubs.embedded,
    stubs.jev.states,
  ]);

async function inputAndConfirm(text: string): Promise<Proposal> {
  const [card] = cardsOf(await say(text));
  const res = await request(app).post(`/api/proposals/${card.id}/confirm`);
  expect(res.status).toBe(200);
  return card;
}

describe("an input", () => {
  it("reaches the models and the tables with pseudonyms only", async () => {
    await inputAndConfirm(INPUT);
    await request(app)
      .post("/api/sources")
      .attach(
        "files",
        Buffer.from("# 倉庫\n\n王小明先生每月盤點一次，電話 0912-345-678。\n"),
        "王小明的筆記.md",
      );

    const [stored, sent] = [await dump(), modelInput()];
    for (const value of REAL) {
      expect(stored).not.toContain(value);
      expect(sent).not.toContain(value);
    }
    expect(stored).toContain("〔人名1〕");
  });

  it("gives one value the same pseudonym in every source", async () => {
    await inputAndConfirm(INPUT);
    await say("請把以下內容輸入到知識庫：盤點表由王小明維護。");

    const { rows } = await db.execute(
      sql`select content from sources where workspace_id = ${caller.current.workspaceId} order by created_at`,
    );
    expect(rows.map((r) => r.content)).toEqual([
      expect.stringContaining("〔人名1〕先生負責倉庫盤點"),
      expect.stringContaining("盤點表由〔人名1〕維護"),
    ]);
  });

  it("is shown back to the 成員 with the real values", async () => {
    const parts = await say(INPUT);
    const [card] = cardsOf(parts);

    expect(card.items.map((item) => item.content)).toEqual([
      "王小明先生負責倉庫盤點",
      "王小明的手機是 0912-345-678",
      "月預算 3 萬元",
    ]);
    const listed = await request(app).get("/api/proposals");
    expect(JSON.stringify(listed.body)).toContain("王小明先生負責倉庫盤點");
    expect(JSON.stringify(listed.body)).not.toContain("〔");
    const read = await request(app).get(`/api/proposals/${card.id}`);
    expect(JSON.stringify(read.body)).toContain("王小明先生負責倉庫盤點");
    expect(JSON.stringify(read.body)).not.toContain("〔");
  });

  it("of a file refused for its format saves no name from its filename in clear", async () => {
    const parts = await say(
      "請記下這份",
      [filePart("王小明先生-0912-345-678.xlsx", "PK")],
      "conv-refused",
    );

    expect(textOf(parts)).toContain(
      "不支援的檔案格式：王小明先生-0912-345-678.xlsx",
    );
    const stored = await dump();
    expect(stored).not.toContain("王小明");
    expect(stored).not.toContain("0912-345-678");
    const res = await request(app).get("/api/conversations/conv-refused");
    expect(JSON.stringify(res.body)).toContain("王小明先生-0912-345-678.xlsx");
  });

  it("stores a 成員's inline edit pseudonymised", async () => {
    const [card] = cardsOf(await say(INPUT));
    const res = await request(app)
      .post(`/api/proposals/${card.id}/confirm`)
      .send({
        edits: [
          { itemId: card.items[0].id, content: "陳大文先生負責倉庫盤點" },
        ],
      });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("陳大文先生負責倉庫盤點");
    expect(await dump()).not.toContain("陳大文");
  });
});

describe("a secret", () => {
  it("in a message is refused, storing nothing", async () => {
    const parts = await say(
      "請把以下內容輸入到知識庫：測試站帳號 admin，密碼是 Hunter2024!",
      [],
      "conv-secret",
    );

    expect(textOf(parts)).toContain("密碼或 API key");
    expect(cardsOf(parts)).toEqual([]);
    const stored = await dump();
    expect(stored).not.toContain("Hunter2024");
    expect(stored).not.toContain('"kind":"message"');
    expect(modelInput()).not.toContain("Hunter2024");
  });

  it("in an attached file is refused, storing nothing", async () => {
    const key = ["sk-proj-", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"].join("");
    const parts = await say("請記下這份", [
      filePart("設定.txt", `部署說明\n\nOPENAI_API_KEY=${key}\n`),
    ]);

    expect(textOf(parts)).toContain("密碼或 API key");
    expect(cardsOf(parts)).toEqual([]);
    expect(await dump()).not.toContain(key);
  });

  it("in an uploaded file is refused with 422", async () => {
    const res = await request(app)
      .post("/api/sources")
      .attach("files", Buffer.from("db password: Hunter2024!\n"), "notes.txt");

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toContain("密碼或 API key");
    expect(await dump()).toBe(NOTHING);
  });

  it("in an inline edit is refused", async () => {
    const [card] = cardsOf(await say(INPUT));
    const res = await request(app)
      .post(`/api/proposals/${card.id}/confirm`)
      .send({
        edits: [{ itemId: card.items[0].id, content: "密碼是 Hunter2024!" }],
      });

    expect(res.status).toBe(422);
    expect(await dump()).not.toContain("Hunter2024");
  });

  it("in an earlier message is never sent on nor saved", async () => {
    stubs.chat.rewrite = "倉庫盤點誰負責？";
    await inputAndConfirm(INPUT);
    await chat(
      [
        { role: "user", parts: [{ type: "text", text: "密碼是 Hunter2024!" }] },
        { role: "assistant", parts: [{ type: "text", text: "已拒絕" }] },
        { role: "user", parts: [{ type: "text", text: "那倉庫呢？" }] },
      ],
      "conv-earlier",
    );

    expect(modelInput()).not.toContain("Hunter2024");
    expect(await dump()).not.toContain("Hunter2024");
  });
});

describe("a question", () => {
  it("by a real name finds the facts stored under its pseudonym", async () => {
    await inputAndConfirm(INPUT);
    stubs.chat.reply = "〔人名1〕先生負責倉庫盤點。[1]";

    const parts = await say("王小明先生負責倉庫盤點嗎");

    expect(textOf(parts)).toBe("王小明先生負責倉庫盤點。[1]");
    expect(citationsOf(parts)[0].text).toBe("王小明先生負責倉庫盤點");
    expect(modelInput()).not.toContain("王小明");
    expect(stubs.chat.prompts.at(-1)).toContain("〔人名1〕先生負責倉庫盤點");
  });

  it("reaches Jev de-identified", async () => {
    await say("王小明先生負責什麼");
    expect(stubs.jev.states.at(-1)).toMatchObject({
      question: "〔人名1〕先生負責什麼",
    });
  });

  it("is saved de-identified and read back with the real values", async () => {
    await inputAndConfirm(INPUT);
    stubs.chat.reply = "〔人名1〕先生負責倉庫盤點。[1]";
    await say("王小明先生負責倉庫盤點嗎", [], "conv-saved");

    expect(await dump()).not.toContain("王小明");
    const res = await request(app).get("/api/conversations/conv-saved");
    expect(JSON.stringify(res.body)).toContain("王小明先生負責倉庫盤點嗎");
    expect(JSON.stringify(res.body)).toContain("王小明先生負責倉庫盤點。[1]");
    const list = await request(app).get("/api/conversations");
    expect((list.body as { title: string }[])[0].title).toBe(
      "王小明先生負責倉庫盤點嗎",
    );
  });
});

describe("marking terms", () => {
  it("pseudonymises a term marked sensitive in later input", async () => {
    const res = await request(app)
      .put("/api/terms")
      .send({ term: "阿德", sensitive: true });
    expect(res.status).toBe(204);

    await say("請把以下內容輸入到知識庫：阿德負責回收箱。");
    expect(await dump()).not.toContain("阿德");
    expect((await request(app).get("/api/terms")).body).toEqual({
      sensitive: ["阿德"],
      excluded: [],
    });
  });

  it("leaves a term marked not sensitive as it is", async () => {
    await request(app)
      .put("/api/terms")
      .send({ term: "高老師", sensitive: false });
    await say("請把以下內容輸入到知識庫：高老師的課在週三。");

    expect(await dump()).toContain("高老師的課在週三");
    const removed = await request(app)
      .delete("/api/terms/excluded")
      .send({ term: "高老師" });
    expect(removed.status).toBe(204);
    expect(
      ((await request(app).get("/api/terms")).body as { excluded: string[] })
        .excluded,
    ).toEqual([]);
  });

  it("rejects a blank or overlong term", async () => {
    for (const term of ["", " ", "長".repeat(101)])
      expect(
        (await request(app).put("/api/terms").send({ term, sensitive: true }))
          .status,
      ).toBe(400);
  });

  it("refuses to mark a secret sensitive", async () => {
    const res = await request(app)
      .put("/api/terms")
      .send({ term: "密碼是 Hunter2024!", sensitive: true });
    expect(res.status).toBe(422);
    expect(await dump()).toBe(NOTHING);
  });
});

describe("when de-identification can't run", () => {
  it("sends nothing on and says so", async () => {
    const analyzer = globalThis.PII_ANALYZER;
    globalThis.PII_ANALYZER = {
      analyze: () => Promise.reject(new Error("down")),
    };
    try {
      const parts = await say(INPUT);
      expect(textOf(parts)).toContain("去識別服務暫時無法使用");
      expect(modelInput()).not.toContain("王小明");

      const res = await request(app)
        .post("/api/sources")
        .attach("files", Buffer.from("王小明先生\n"), "a.txt");
      expect(res.status).toBe(503);
      expect(await dump()).toBe(NOTHING);
    } finally {
      globalThis.PII_ANALYZER = analyzer;
    }
  });
});

describe("a guest workspace", () => {
  it("is stored as given", async () => {
    caller.current = {
      workspaceId: await createWorkspace("guest", "trial"),
      userId: "guest-a",
      role: "guest",
    };
    await say(INPUT);
    expect(await dump()).toContain("王小明先生負責倉庫盤點");
  });
});
