import { sql } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db.js";
import {
  type Proposal,
  propose,
  searchChunks,
  searchFacts,
} from "./knowledge-base.js";
import { saveConversation } from "./conversations.js";
import { pseudonymize, reidentify } from "./pseudonyms.js";
import { installStubModels } from "./stub-models.js";
import { createWorkspace, type Caller } from "./workspaces.js";

// 硬刪除 (spec story 45): the uploader of a 來源 deletes it with everything
// drawn from it, the one exception to 來源 being immutable. Only a record that
// a deletion happened stays. Proposals are made through the knowledge base
// module; deleting and confirming go through HTTP.
const caller = vi.hoisted(() => ({ current: undefined as unknown as Caller }));
vi.mock("./workspaces.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspaces.js")>()),
  callerOf: () => Promise.resolve(caller.current),
}));
const { app } = await import("./app.js");

let workspaceId: string;

function as(userId: string) {
  caller.current = { workspaceId, userId, role: "member" };
}

beforeEach(async () => {
  installStubModels();
  workspaceId = await createWorkspace("guest", "test");
  as("member-a");
});

const remove = (sourceId: string) =>
  request(app).delete(`/api/sources/${sourceId}`);
const confirm = (id: string, body: object = {}) =>
  request(app).post(`/api/proposals/${id}/confirm`).send(body);

function proposeFacts(userId: string, ...texts: string[]) {
  return propose(workspaceId, userId, {
    source: { kind: "message", content: texts.join("\n") },
    facts: texts,
  });
}

function proposeFile(userId: string, filename: string, text: string) {
  return propose(workspaceId, userId, {
    source: { kind: "file", filename, content: text },
    chunks: [{ path: [filename], content: text, embedText: text }],
    facts: [
      {
        content: text,
        chunk: 0,
        entities: [{ name: "倉庫盤點", kind: "other" }],
      },
    ],
  });
}

function proposeCorrection(
  userId: string,
  targetFactId: string,
  change: { content: string } | "obsolete",
) {
  return propose(workspaceId, userId, {
    source: { kind: "message", content: "更正" },
    facts: [],
    corrections: [
      {
        targetFactId,
        reason: "更正",
        effectiveAt: new Date().toISOString(),
        ...(change === "obsolete"
          ? { kind: "obsolete" as const }
          : { kind: "supersede" as const, content: change.content }),
      },
    ],
  });
}

async function confirmed(proposal: Proposal) {
  expect((await confirm(proposal.id)).status).toBe(200);
  return proposal;
}

const currentFacts = async (query: string) =>
  (await searchFacts(workspaceId, query, 20)).map((f) => f.content).sort();

/** Every row of the workspace's tables that mentions the text. */
async function rowsMentioning(text: string) {
  const { rows } = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'workspace_id'
  `);
  const found: string[] = [];
  for (const { table_name } of rows) {
    const { rows: hits } = await db.execute(
      sql`select 1 from ${sql.identifier(table_name)} t where t.workspace_id = ${workspaceId} and t::text like ${`%${text}%`}`,
    );
    if (hits.length) found.push(table_name);
  }
  return found;
}

describe("deleting a 來源", () => {
  it("removes it and everything drawn from it, leaving a record without its content", async () => {
    await confirmed(await proposeFacts("member-a", "M 代表質量"));
    const card = await confirmed(
      await proposeFile("member-a", "inventory.md", "倉庫盤點每月一次"),
    );

    const res = await remove(card.sourceId);

    expect(res.status).toBe(204);
    expect(await currentFacts("倉庫盤點每月一次")).toEqual(["M 代表質量"]);
    expect(await searchChunks(workspaceId, "倉庫盤點每月一次", 5)).toEqual([]);
    expect(await rowsMentioning("倉庫盤點")).toEqual([]);
    expect(await rowsMentioning("inventory.md")).toEqual([]);
    const { rows } = await db.execute<Record<string, unknown>>(
      sql`select * from deletions where workspace_id = ${workspaceId}`,
    );
    expect(rows).toHaveLength(1);
    // Who, when and which source id: no column for anything of its content.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "deleted_at",
      "deleted_by",
      "id",
      "source_id",
      "workspace_id",
    ]);
    expect(rows[0]).toMatchObject({
      source_id: card.sourceId,
      deleted_by: "member-a",
    });
  });

  it("is refused to anyone but the uploader, and another workspace's source does not exist", async () => {
    const card = await confirmed(await proposeFacts("member-a", "M 代表質量"));

    as("member-b");
    const notYours = await remove(card.sourceId);
    caller.current = {
      workspaceId: await createWorkspace("guest", "other"),
      userId: "member-a",
      role: "member",
    };
    const elsewhere = await remove(card.sourceId);
    const unknown = await remove("not-a-uuid");
    as("member-a");

    expect(notYours.status).toBe(403);
    expect(elsewhere.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await currentFacts("M 代表質量")).toEqual(["M 代表質量"]);
  });

  it("leaves nothing half done when a step fails", async () => {
    const card = await confirmed(
      await proposeFile("member-a", "inventory.md", "倉庫盤點每月一次"),
    );
    // The deletion's last write fails, for this workspace only.
    const fn = sql.identifier(`fail_${workspaceId.replaceAll("-", "")}`);
    await db.execute(sql`
      create function ${fn}() returns trigger language plpgsql as $$
      begin
        if new.workspace_id = '${sql.raw(workspaceId)}' then
          raise exception 'injected failure';
        end if;
        return new;
      end $$`);
    await db.execute(
      sql`create trigger ${fn} before insert on deletions for each row execute function ${fn}()`,
    );
    try {
      const res = await remove(card.sourceId);
      expect(res.status).toBe(500);
    } finally {
      await db.execute(sql`drop trigger ${fn} on deletions`);
      await db.execute(sql`drop function ${fn}()`);
    }

    expect(await currentFacts("倉庫盤點每月一次")).toEqual([
      "倉庫盤點每月一次",
    ]);
    expect(
      (await searchChunks(workspaceId, "倉庫盤點每月一次", 5)).length,
    ).toBe(1);
    expect(await rowsMentioning("倉庫盤點")).toEqual(
      expect.arrayContaining(["sources", "source_chunks", "facts", "entities"]),
    );
    expect((await remove(card.sourceId)).status).toBe(204);
  });

  it("undoes the 取代 and 過時 its proposals made, so the facts they ended are current again", async () => {
    const taken = await confirmed(
      await proposeFacts("member-a", "R 代表取代率"),
    );
    const mass = await confirmed(await proposeFacts("member-a", "M 代表質量"));
    const replaced = await confirmed(
      await proposeCorrection("member-a", taken.items[0].factId!, {
        content: "R 代表回收率",
      }),
    );
    const obsoleted = await confirmed(
      await proposeCorrection("member-a", mass.items[0].factId!, "obsolete"),
    );
    expect(await currentFacts("R 代表取代率")).toEqual(["R 代表回收率"]);

    expect((await remove(replaced.sourceId)).status).toBe(204);
    expect((await remove(obsoleted.sourceId)).status).toBe(204);

    expect(await currentFacts("R 代表取代率")).toEqual([
      "M 代表質量",
      "R 代表取代率",
    ]);
    const [fact] = await searchFacts(workspaceId, "R 代表取代率", 1);
    expect(fact.history).toBeUndefined();
  });

  it("keeps a later version current when the deleted one was replaced since", async () => {
    const taken = await confirmed(
      await proposeFacts("member-a", "R 代表取代率"),
    );
    const recycled = await confirmed(
      await proposeCorrection("member-a", taken.items[0].factId!, {
        content: "R 代表回收率",
      }),
    );
    await confirmed(
      await proposeCorrection("member-b", recycled.items[0].factId!, {
        content: "R 代表再生率",
      }),
    );

    expect((await remove(recycled.sourceId)).status).toBe(204);

    expect(await currentFacts("R 代表取代率")).toEqual(["R 代表再生率"]);
    const [fact] = await searchFacts(workspaceId, "R 代表再生率", 1);
    expect(fact.history?.map((v) => v.content)).toEqual([
      "R 代表取代率",
      "R 代表再生率",
    ]);
  });

  it("drops other members' pending changes to its facts, and revives what its confirmation expired", async () => {
    const older = await proposeFacts("member-b", "M 代表質量");
    const card = await confirmed(await proposeFacts("member-a", "M 代表質量"));
    const correction = await proposeCorrection(
      "member-b",
      card.items[0].factId!,
      { content: "M 代表重量" },
    );
    const before = (await request(app).get("/api/proposals"))
      .body as Proposal[];
    expect(before.map((p) => p.id)).toEqual([correction.id]);

    expect((await remove(card.sourceId)).status).toBe(204);

    const after = (await request(app).get("/api/proposals")).body as Proposal[];
    expect(after.map((p) => [p.id, p.items.map((i) => i.status)])).toEqual([
      [older.id, ["pending"]],
    ]);
    expect((await confirm(older.id)).status).toBe(200);
    expect(await currentFacts("M 代表質量")).toEqual(["M 代表質量"]);
  });
});

describe("a saved conversation", () => {
  it("loses the deleted source's cards and citations, and keeps the rest", async () => {
    const kept = await confirmed(await proposeFacts("member-a", "M 代表質量"));
    const card = await confirmed(
      await proposeFile("member-a", "inventory.md", "倉庫盤點每月一次"),
    );
    const cite = (id: string, kind: string) => ({
      type: "data-citation",
      id,
      data: { id, kind, marker: 1, label: "知識庫", text: "…" },
    });
    const answer: { type: string; [key: string]: unknown }[] = [
      { type: "text", text: "每月一次 [1]" },
      { type: "data-proposal", id: card.id, data: card },
      cite(card.items[0].factId!, "fact"),
      cite(kept.items[0].factId!, "fact"),
      { type: "data-proposal", id: kept.id, data: kept },
    ];
    as("member-b");
    await saveConversation(caller.current, "c-1", [
      { role: "user", parts: [{ type: "text", text: "盤點多久一次？" }] },
      { role: "assistant", parts: answer },
    ]);
    as("member-a");

    expect((await remove(card.sourceId)).status).toBe(204);

    as("member-b");
    const res = await request(app).get("/api/conversations/c-1");
    const parts = (
      res.body as { messages: { parts: { type: string; id?: string }[] }[] }
    ).messages[1].parts;
    expect(parts.map((p) => [p.type, p.id])).toEqual([
      ["text", undefined],
      ["data-citation", kept.items[0].factId],
      ["data-proposal", kept.id],
    ]);
    expect(await rowsMentioning("倉庫盤點")).toEqual([]);
  });
});

describe("deleting a 來源 of the team workspace", () => {
  beforeEach(async () => {
    workspaceId = await createWorkspace("team", "test");
    as("member-a");
  });

  /** Proposes the text as a message, pseudonymised as the chat does. */
  async function input(userId: string, text: string) {
    const [content] = await pseudonymize(workspaceId, [text]);
    return {
      content,
      card: await propose(workspaceId, userId, {
        source: { kind: "message", content },
        facts: [content],
      }),
    };
  }

  it("forgets the pseudonyms only it used, and keeps the shared ones", async () => {
    const mine = await input("member-a", "王小明先生與李大華先生負責盤點");
    const other = await input("member-b", "李大華先生負責回收");
    const [ming, hua] = mine.content.match(/〔[^〕]+〕/g)!;
    expect(other.content).toContain(hua);

    expect((await remove(mine.card.sourceId)).status).toBe(204);

    expect(await reidentify(workspaceId, [ming, hua])).toEqual([
      ming,
      "李大華",
    ]);
    expect(await rowsMentioning(ming)).toEqual([]);
  });
});
