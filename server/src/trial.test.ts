import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, like, not, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "./app.js";
import type { Citation } from "./chat.js";
import type { Proposal } from "./knowledge-base.js";
import { embeddings } from "./models.js";
import { installStubModels } from "./stub-models.js";
import { stubSession } from "./stub-auth.js";
import { db } from "./db.js";
import { workspaces } from "./db/schema.js";
import { workspaceTables } from "./demo-seed.js";
import {
  deidentifies,
  deleteIdleTrials,
  GUEST_LIMITS,
  policyOf,
} from "./trial.js";

// 訪客試用 through the HTTP API, signed in by stub cookies. Each test signs in
// as new 訪客 (a random user id), so each gets a trial workspace of its own.

/** The 示範資料's first formula, from 2026-03-02 until 2026-05-18. */
const V1_FORMULA =
  "避免排放公式為 A = W × EF × R（A：每筆交換的避免排放量 kgCO2e；W：物品重量 kg；EF：類別新品生產排放係數；R：取代率）";

/** The current avoided-emissions formula after the 示範資料 seed. */
const CURRENT_FORMULA = "避免排放公式為 A = W × EF × R × L";

interface Part {
  type: string;
  data?: unknown;
}

const newGuest = () => `user_guest_${randomBytes(6).toString("hex")}`;

/** A signed-in 訪客 who passed the human check (the stub Turnstile). */
async function verifiedGuest(userId = newGuest()) {
  const agent = request.agent(app).set("Cookie", stubSession(userId, "guest"));
  const res = await agent
    .post("/api/trial/verify")
    .send({ token: "stub-pass" });
  expect(res.status).toBe(200);
  return agent;
}

type Agent = Awaited<ReturnType<typeof verifiedGuest>>;

async function chat(agent: Agent, text: string, files: object[] = []) {
  const res = await agent
    .post("/api/chat")
    .send({
      messages: [
        {
          id: "m0",
          role: "user",
          parts: [{ type: "text", text }, ...files],
        },
      ],
    })
    .buffer(true)
    .parse((r, done) => {
      let body = "";
      r.on("data", (chunk: Buffer) => (body += chunk.toString()));
      r.on("end", () => done(null, body));
    });
  return {
    status: res.status,
    body:
      res.status === 200
        ? undefined
        : (JSON.parse(res.body as string) as unknown),
    parts:
      res.status === 200
        ? (res.body as string)
            .split("\n")
            .filter((line) => line.startsWith("data: {"))
            .map((line) => JSON.parse(line.slice("data: ".length)) as Part)
        : [],
  };
}

async function citedFacts(agent: Agent, question: string) {
  const { parts } = await chat(agent, question);
  return parts
    .filter((p) => p.type === "data-citation")
    .map((p) => p.data as Citation)
    .filter((c) => c.kind === "fact");
}

beforeEach(() => {
  installStubModels().chat.reply = "A = W × EF × R × L。[1]";
});

describe("a 訪客's trial workspace", () => {
  it("holds the 示範資料: the current formula, with the one it replaced", async () => {
    const guest = await verifiedGuest();

    const [cited] = await citedFacts(guest, CURRENT_FORMULA);

    expect(cited.text).toContain("A = W × EF × R × L");
    expect(cited.history?.map((entry) => entry.content)).toEqual([
      expect.stringContaining("A = W × EF × R（"),
      expect.stringContaining("A = W × EF × R × L"),
    ]);
    expect(cited.history?.[1].validFrom).toBe("2026-05-17T16:00:00.000Z");
  });

  it("answers 「2026 年三月時我們的避免排放公式是什麼？」 with the formula of then, and what changed since", async () => {
    const question = "2026 年三月時我們的避免排放公式是什麼？";
    const models = installStubModels();
    models.chat.reply = "見 [1][2][3][4][5][6]";
    // As a real embedding would, the question points at the formula.
    models.vectors.set(question, await embeddings().embedQuery(V1_FORMULA));
    const guest = await verifiedGuest();

    const cited = await citedFacts(guest, question);

    const texts = cited.map((c) => c.text);
    expect(texts).toContainEqual(
      expect.stringMatching(
        /A = W × EF × R（[\s\S]*之後的變更：2026-05-18 起改為「.*A = W × EF × R × L/,
      ),
    );
    expect(texts).not.toContainEqual(
      expect.stringMatching(/^[^\n]*A = W × EF × R × L/),
    );
  });
});

describe("the human check", () => {
  it("keeps a 訪客 out of every knowledge base API until they pass it", async () => {
    const guest = request
      .agent(app)
      .set("Cookie", stubSession(newGuest(), "guest"));

    const refused = await guest
      .post("/api/trial/verify")
      .send({ token: "not-a-human" });
    const me = await guest.get("/api/me");
    const responses = [
      await guest.post("/api/chat").send({ messages: [] }),
      await guest.get("/api/conversations"),
      await guest.get("/api/proposals"),
      await guest.post("/api/sources"),
      await guest.post("/api/trial/reset"),
    ];

    expect(refused.status).toBe(403);
    expect(me.body).toMatchObject({
      role: "guest",
      trial: { verified: false },
    });
    for (const res of responses)
      expect(res.body).toMatchObject({ code: "verify" });
  });

  it("is only for a 訪客: a 成員 has no trial to verify or reset", async () => {
    const member = request
      .agent(app)
      .set("Cookie", stubSession("user_trial_member", "member"));

    const verify = await member
      .post("/api/trial/verify")
      .send({ token: "stub-pass" });
    const reset = await member.post("/api/trial/reset");
    const me = await member.get("/api/me");

    expect(verify.status).toBe(403);
    expect(reset.status).toBe(403);
    expect(me.body).toEqual({ userId: "user_trial_member", role: "member" });
  });

  it("keeps the trial a 訪客 already has when they pass it again", async () => {
    const userId = newGuest();
    const guest = await verifiedGuest(userId);
    const [proposal] = await uploadExample(guest);

    await verifiedGuest(userId);

    const pending = await guest.get("/api/proposals");
    expect(pending.body).toEqual([
      expect.objectContaining({ id: proposal.id }),
    ]);
  });
});

const EXAMPLE = readFileSync(
  path.join(import.meta.dirname, "../demo-data/upload/meeting-2026-11-12.txt"),
);

async function uploadExample(agent: Agent): Promise<Proposal[]> {
  const res = await agent
    .post("/api/sources")
    .attach("files", EXAMPLE, "meeting-2026-11-12.txt");
  expect(res.status).toBe(201);
  return (res.body as { proposals: Proposal[] }).proposals;
}

describe("a 訪客's APIs", () => {
  it("are limited to their own trial workspace", async () => {
    const member = request
      .agent(app)
      .set("Cookie", stubSession("user_trial_member", "member"));
    const teamInput = await member.post("/api/chat").send({
      id: `team-${randomBytes(4).toString("hex")}`,
      messages: [
        {
          id: "m0",
          role: "user",
          parts: [
            { type: "text", text: "請把以下內容輸入到知識庫：團隊的秘密是 42" },
          ],
        },
      ],
    });
    const teamProposal = proposalIn(teamInput.text);
    // Rejected, so the team workspace keeps no fact; a 訪客 must still not
    // find it.
    await member.post(`/api/proposals/${teamProposal.id}/reject`);
    const teamConversation = (await member.get("/api/conversations")).body as {
      id: string;
    }[];
    const other = await verifiedGuest();
    const [otherProposal] = await uploadExample(other);
    const otherConversation = `other-${randomBytes(4).toString("hex")}`;
    await other.post("/api/chat").send({
      id: otherConversation,
      messages: [
        { id: "m0", role: "user", parts: [{ type: "text", text: "你好" }] },
      ],
    });

    const guest = await verifiedGuest();
    const foreign = [teamProposal.id, otherProposal.id];
    for (const id of foreign) {
      expect((await guest.post(`/api/proposals/${id}/confirm`)).status).toBe(
        404,
      );
      expect((await guest.post(`/api/proposals/${id}/reject`)).status).toBe(
        404,
      );
    }
    for (const id of [teamConversation[0].id, otherConversation]) {
      expect((await guest.get(`/api/conversations/${id}`)).status).toBe(404);
      const cont = await guest.post("/api/chat").send({
        id,
        messages: [
          { id: "m0", role: "user", parts: [{ type: "text", text: "接著" }] },
        ],
      });
      expect(cont.status).toBe(404);
    }
    expect((await guest.get("/api/proposals")).body).toEqual([]);
    expect((await guest.get("/api/conversations")).body).toEqual([]);
    const cited = await citedFacts(guest, "團隊的秘密是 42");
    expect(cited.map((c) => c.text).join()).not.toContain("42");
    // The other 訪客's upload is still theirs, untouched.
    expect((await other.get("/api/proposals")).body).toEqual([
      expect.objectContaining({ id: otherProposal.id, status: "pending" }),
    ]);
  });
});

function proposalIn(stream: string): Proposal {
  const part = stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Part)
    .find((p) => p.type === "data-proposal");
  return part!.data as Proposal;
}

describe("POST /api/trial/reset", () => {
  it("puts the trial back to the 示範資料", async () => {
    const guest = await verifiedGuest();
    const [proposal] = await uploadExample(guest);
    const added = proposal.items[0].content!;
    await guest.post(`/api/proposals/${proposal.id}/confirm`);
    await guest.post("/api/chat").send({
      id: `c-${randomBytes(4).toString("hex")}`,
      messages: [
        { id: "m0", role: "user", parts: [{ type: "text", text: "你好" }] },
      ],
    });
    expect((await citedFacts(guest, added))[0].text).toBe(added);

    const res = await guest.post("/api/trial/reset");

    expect(res.status).toBe(200);
    expect((await citedFacts(guest, added))[0]?.text).not.toBe(added);
    expect((await guest.get("/api/conversations")).body).toEqual([]);
    const [cited] = await citedFacts(guest, CURRENT_FORMULA);
    expect(cited.text).toContain("A = W × EF × R × L");
  });
});

describe("an idle trial", () => {
  it("is deleted after 7 days without a request; an active one stays", async () => {
    const idleUser = newGuest();
    const idle = await verifiedGuest(idleUser);
    const [proposal] = await uploadExample(idle);
    const active = await verifiedGuest();
    await db
      .update(workspaces)
      .set({ lastActiveAt: new Date(Date.now() - 7 * DAY - 60_000) })
      .where(eq(workspaces.ownerId, idleUser));

    await deleteIdleTrials();

    expect((await idle.get("/api/me")).body).toMatchObject({
      trial: { verified: false },
    });
    expect((await active.get("/api/me")).body).toMatchObject({
      trial: { verified: true },
    });
    // Back after the deletion, the 訪客 starts again from the 示範資料.
    await verifiedGuest(idleUser);
    expect((await idle.get("/api/proposals")).body).toEqual([]);
    expect(
      (await idle.post(`/api/proposals/${proposal.id}/confirm`)).status,
    ).toBe(404);
  });
});

const DAY = 24 * 60 * 60 * 1000;

const textFile = (text: string, filename = "note.txt") => ({
  type: "file",
  mediaType: "text/plain",
  filename,
  url: `data:text/plain;base64,${Buffer.from(text).toString("base64")}`,
});

describe("a 訪客's daily limits", () => {
  it("refuse the 31st message of the day with a clear message", async () => {
    installStubModels().chat.reply = "好。[1]";
    const guest = await verifiedGuest();
    for (let i = 0; i < 30; i++)
      expect((await chat(guest, `問題 ${i}`)).status).toBe(200);

    const over = await chat(guest, "第 31 則");

    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({
      code: "messages",
      error: expect.stringContaining("每天 30 則") as unknown,
    });
  });

  it("refuse the 6th uploaded file of the day, in the chat or by the endpoint", async () => {
    const guest = await verifiedGuest();
    await uploadExample(guest);
    await uploadExample(guest);
    const attached = await chat(guest, "", [
      textFile("一。", "a.txt"),
      textFile("二。", "b.txt"),
      textFile("三。", "c.txt"),
    ]);

    const endpoint = await guest
      .post("/api/sources")
      .attach("files", EXAMPLE, "meeting-2026-11-12.txt");
    const inChat = await chat(guest, "", [textFile("四。")]);

    expect(attached.status).toBe(200);
    for (const res of [
      endpoint,
      { status: inChat.status, body: inChat.body },
    ]) {
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({
        code: "uploads",
        error: expect.stringContaining("每天 5 個檔案") as unknown,
      });
    }
  });

  it("refuse a file over 1 MB, which a 成員 may upload", async () => {
    const big = Buffer.alloc(1024 * 1024 + 1, "字");
    const guest = await verifiedGuest();

    const res = await guest
      .post("/api/sources")
      .attach("files", big, "big.txt");

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: expect.stringContaining("1 MB") as unknown,
    });
  });

  it("pause every 訪客's trial once all of them used up the day's cap", async () => {
    const guest = await verifiedGuest();
    process.env.GUEST_DAILY_CAP = "0";
    try {
      const res = await chat(guest, "還能問嗎？");

      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({
        code: "paused",
        error: expect.stringContaining("訪客試用暫停") as unknown,
      });
    } finally {
      delete process.env.GUEST_DAILY_CAP;
    }
  });
});

describe("a 訪客's requests", () => {
  it("are answered and extracted by GUEST_MODEL", async () => {
    process.env.GUEST_MODEL = "test/guest-model";
    try {
      const { chat: model } = installStubModels();
      model.reply = "A = W × EF × R × L。[1]";
      const guest = await verifiedGuest();

      await citedFacts(guest, CURRENT_FORMULA);
      await uploadExample(guest);
      await chat(guest, "請把以下內容輸入到知識庫：L 預設 0.6");

      expect(model.models.length).toBeGreaterThan(2);
      expect(new Set(model.models)).toEqual(new Set(["test/guest-model"]));
    } finally {
      delete process.env.GUEST_MODEL;
    }
  });
});

describe("GET /api/trial/example", () => {
  it("serves the example upload, which replaces the seed's formula", async () => {
    const guest = await verifiedGuest();

    const res = await guest.get("/api/trial/example");

    expect(res.status).toBe(200);
    expect(res.text).toContain("A = W × EF × R × L − T");
  });
});

describe("what a role may do", () => {
  it("holds a 訪客 to the trial: limits, GUEST_MODEL, a trial to reset, no de-identification", () => {
    expect(policyOf("guest")).toEqual({
      limits: GUEST_LIMITS,
      purpose: "guest",
      trial: true,
      deidentified: false,
    });
  });

  it("leaves a 成員 unlimited, de-identified, with each purpose's own model", () => {
    expect(policyOf("member")).toEqual({
      limits: null,
      purpose: undefined,
      trial: false,
      deidentified: true,
    });
  });

  it("de-identifies the team workspace only", () => {
    expect(deidentifies("team")).toBe(true);
    expect(deidentifies("guest")).toBe(false);
    expect(deidentifies("demo")).toBe(false);
  });
});

describe("a 訪客 uploading the example file", () => {
  it("is proposed a 取代 of the seed's current formula", async () => {
    const guest = await verifiedGuest();

    const [proposal] = await uploadExample(guest);

    const replaced = proposal.items.filter((i) => i.kind === "supersede");
    expect(replaced).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("A = W × EF × R × L − T") as unknown,
        target: expect.objectContaining({
          content: expect.stringMatching(
            /^避免排放公式為 A = W × EF × R × L，/,
          ) as unknown,
        }) as unknown,
        reason: expect.any(String) as unknown,
      }),
    ]);
  });
});

describe("a 訪客's question about the 示範資料's entities", () => {
  // A query vector no stored fact or passage shares a direction with: the
  // vector lane finds nothing, so whatever is cited came through the graph.
  const blind = (question: string) => {
    const vector = new Array<number>(1536).fill(0);
    vector[1535] = 1;
    const models = installStubModels();
    models.vectors.set(question, vector);
    models.chat.reply = "見 [1][2][3][4][5][6]";
  };

  it("finds the current formula by the algorithm's alias", async () => {
    const question = "減碳計算模型現在怎麼算？";
    blind(question);
    const guest = await verifiedGuest();

    const cited = await citedFacts(guest, question);

    expect(cited.map((c) => c.text)).toContainEqual(
      expect.stringContaining("A = W × EF × R × L"),
    );
  });

  it("finds it a hop away, through who is responsible for the algorithm", async () => {
    const question = "林小樹負責的那套現在怎麼算？";
    blind(question);
    const guest = await verifiedGuest();

    const cited = await citedFacts(guest, question);

    expect(cited.map((c) => c.text)).toContainEqual(
      expect.stringContaining("A = W × EF × R × L"),
    );
  });

  it("finds nothing when the question names no entity", async () => {
    const question = "那個東西現在怎麼算？";
    blind(question);
    const guest = await verifiedGuest();

    expect(await citedFacts(guest, question)).toEqual([]);
  });
});

describe("copying the 示範資料 into a trial", () => {
  it("copies every workspace table, #31's entities included, re-pointing every reference into the trial", async () => {
    const userId = newGuest();
    await verifiedGuest(userId);
    const [trial] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId));
    const [template] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.kind, "demo"),
          not(like(workspaces.name, "%(building)")),
        ),
      )
      .orderBy(desc(workspaces.createdAt))
      .limit(1);
    const count = async (table: string, ws: string) =>
      Number(
        (
          await db.execute<{ n: string }>(
            sql`select count(*) n from ${sql.identifier(table)} where workspace_id = ${ws}`,
          )
        ).rows[0].n,
      );

    const tables = workspaceTables().map((t) => getTableConfig(t));
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "entities",
        "entity_aliases",
        "fact_entities",
        "edges",
      ]),
    );
    for (const { name, foreignKeys, columns } of tables) {
      const copied = await count(name, trial.id);
      expect(copied, name).toBe(await count(name, template.id));
      if (
        ["entities", "entity_aliases", "fact_entities", "edges"].includes(name)
      )
        expect(copied, name).toBeGreaterThan(0);
      if (columns.some((c) => c.name === "id")) {
        const { rows } = await db.execute(
          sql`select 1 from ${sql.identifier(name)} a join ${sql.identifier(name)} b on a.id = b.id where a.workspace_id = ${trial.id} and b.workspace_id = ${template.id}`,
        );
        expect(rows, `${name} ids`).toEqual([]);
      }
      for (const fk of foreignKeys) {
        const ref = fk.reference();
        const target = getTableConfig(ref.foreignTable).name;
        if (target === "workspaces") continue;
        for (const [i, column] of ref.columns.entries()) {
          const { rows } = await db.execute(sql`
            select 1 from ${sql.identifier(name)} r
            join ${sql.identifier(target)} t
              on t.${sql.identifier(ref.foreignColumns[i].name)} = r.${sql.identifier(column.name)}
            where r.workspace_id = ${trial.id} and t.workspace_id <> ${trial.id}`);
          expect(rows, `${name}.${column.name} → ${target}`).toEqual([]);
        }
      }
    }
  });
});

describe("a 訪客's trial and de-identification (#34)", () => {
  const PHONE = "0912-345-678";

  it("is not de-identified: an input keeps its values, and no pseudonym is made", async () => {
    const userId = newGuest();
    const guest = await verifiedGuest(userId);

    const { parts } = await chat(
      guest,
      `請把以下內容輸入到知識庫：林小樹的電話是 ${PHONE}`,
    );

    const card = parts.find((p) => p.type === "data-proposal")!
      .data as Proposal;
    expect(card.items[0].content).toContain(PHONE);
    expect(card.items[0].content).not.toContain("〔");
    expect(await rowsOf("pseudonyms", await trialIdOf(userId))).toBe(0);
  });

  it("has no 敏感詞 or 排除詞 list: /api/terms is for 成員 only", async () => {
    const guest = await verifiedGuest();

    const put = await guest
      .put("/api/terms")
      .send({ term: "林小樹", sensitive: true });
    const get = await guest.get("/api/terms");

    expect(put.status).toBe(403);
    expect(get.status).toBe(403);
  });

  it("copies none of the template's pseudonyms or 排除詞, and reset leaves none", async () => {
    const userId = newGuest();
    const guest = await verifiedGuest(userId);
    const trial = await trialIdOf(userId);
    await db.execute(
      sql`insert into excluded_terms (workspace_id, term, created_by) values (${trial}, '好物輪轉', ${userId})`,
    );

    await guest.post("/api/trial/reset");

    const names = workspaceTables().map((t) => getTableConfig(t).name);
    expect(names).not.toContain("pseudonyms");
    expect(names).not.toContain("excluded_terms");
    expect(await rowsOf("pseudonyms", trial)).toBe(0);
    expect(await rowsOf("excluded_terms", trial)).toBe(0);
  });
});

async function trialIdOf(userId: string): Promise<string> {
  const [trial] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId));
  return trial.id;
}

async function rowsOf(table: string, workspaceId: string): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(
    sql`select count(*) n from ${sql.identifier(table)} where workspace_id = ${workspaceId}`,
  );
  return Number(rows[0].n);
}
