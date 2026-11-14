import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSubject, retrieve } from "./agent/ask.js";
import { app } from "./app.js";
import { db } from "./db.js";
import { CANDIDATE_AT } from "./entities.js";
import {
  RELATED_AT,
  SAME_CLAIM_AT,
  searchGraph,
  type Proposal,
} from "./knowledge-base.js";
import type { SystemOne } from "./models.js";
import { pseudonymize, reidentify } from "./pseudonyms.js";
import { KnowledgeRetriever } from "./retriever.js";
import { stubSession } from "./stub-auth.js";
import { grade, type Reply, TEAM_FAQ } from "./team-faq.js";

// Ticket #40: the team FAQ (team-faq.ts, PROVISIONAL questions) asked of a
// knowledge base built through the real input path, with the real models:
// `npm run test:live -w server`. Seeded once per run, as a 成員 of the team
// workspace (so de-identified, ADR-0004):
//   1. POST /api/sources each seed file, kb-chatbot faq.txt and
//      07-megaweaving-net-platform.md; confirm each proposal.
//   2. The meeting's changes as members' 更正 in the chat (the 輸入 subgraph
//      doesn't yet tell 取代 from 新增, #27), confirmed.
//   3. upload/meeting-2026-11-12.txt, left 待確認.
// Then each question in a new conversation over /api/chat, graded by
// team-faq.ts. Last, the thresholds still to calibrate are measured on this
// knowledge base into a report (.scratch/kb-chatbot/evidence/40/).

const ROOT = path.join(import.meta.dirname, "../..");
const SEED = path.join(ROOT, "server/demo-data/seed");
const KB_CHATBOT = path.join(ROOT, ".scratch/kb-chatbot/fixtures/upload");
const REPORT = path.join(ROOT, ".scratch/kb-chatbot/evidence/40");
const MEMBER = stubSession("user_eval_member", "member");

const FILES = [
  path.join(SEED, "01-wiki-avoided-emissions.md"),
  path.join(SEED, "02-meeting-2026-05-14.txt"),
  path.join(SEED, "03-repo-weekly-2026-05-18.md"),
  path.join(KB_CHATBOT, "faq.txt"),
  path.join(KB_CHATBOT, "07-megaweaving-net-platform.md"),
];
// Each a question, then the member's 更正 of its answer in the same
// conversation, as in the chat: the facts the answer cited come first as
// what the correction is about.
const CORRECTIONS = [
  [
    "wiki 上寫的避免排放公式是什麼？",
    "更正：wiki 上的避免排放公式 A = W × EF × R 自 2026-05-18 起改為 A = W × EF × R × L（L 為壽命比，二手物品預估剩餘壽命 ÷ 新品壽命），這是 2026-05-14 週會的決議。",
  ],
  [
    "每月減碳報表 CSV 要寄給誰？",
    "每月 5 日前把減碳報表 CSV 寄給霧橋市循環經濟辦公室這件事，自 2026-07-01 起不再適用：社區減碳試辦計畫 2026-06 底結束，不延長。",
  ],
];
const PENDING_FILE = path.join(
  ROOT,
  "server/demo-data/upload/meeting-2026-11-12.txt",
);

// First questions that leave their subject unnamed, for Jev's threshold.
const UNNAMED = [
  "它現在怎麼算？",
  "那是誰負責的？",
  "當時為什麼這樣決定？",
  "這個什麼時候生效？",
  "後來改成什麼了？",
];

interface Part {
  type: string;
  id?: string;
  delta?: string;
  data?: unknown;
}

/** What the run saw, for the report. */
const seen = {
  seeding: [] as object[],
  answers: [] as object[],
  jev: [] as { question: string; noul: number }[],
};

let workspaceId: string;

const post = (url: string) => request(app).post(url).set("Cookie", MEMBER);

/** A message in a new conversation, or after `answered` (question + parts). */
async function chat(
  text: string,
  answered?: { question: string; parts: Part[] },
): Promise<Part[]> {
  const user = (id: string, text: string) => ({
    id,
    role: "user",
    parts: [{ type: "text", text }],
  });
  const before = answered
    ? [
        user("m0", answered.question),
        {
          id: "m1",
          role: "assistant",
          parts: [
            { type: "text", text: answerOf(answered.parts) },
            ...answered.parts.filter((p) => p.type === "data-citation"),
          ],
        },
      ]
    : [];
  const res = await post("/api/chat")
    .send({ messages: [...before, user(`m${before.length}`, text)] })
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

const answerOf = (parts: Part[]) =>
  parts
    .filter((p) => p.type === "text-delta" && p.id === "answer")
    .map((p) => p.delta)
    .join("");

/** Confirms a proposal, acknowledging what changed since, as 仍確認 does. */
async function confirm(proposal: Proposal, from: string) {
  let res = await post(`/api/proposals/${proposal.id}/confirm`).send({});
  const body = res.body as { conflicts?: { changeId: string }[] };
  const conflicts = res.status === 409 ? (body.conflicts ?? []) : [];
  if (conflicts.length)
    res = await post(`/api/proposals/${proposal.id}/confirm`).send({
      acknowledged: conflicts.map((c) => c.changeId),
    });
  seen.seeding.push({
    from,
    items: proposal.items.map((i) => ({
      kind: i.kind,
      content: i.content,
      effectiveAt: i.effectiveAt,
    })),
    entities: proposal.entities,
    expires: proposal.expires,
    conflicts,
    status: res.status,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function upload(file: string): Promise<Proposal[]> {
  const res = await post("/api/sources").attach(
    "files",
    readFileSync(file),
    path.basename(file),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { proposals: Proposal[] }).proposals;
}

/** Records Jev's score of every first question the chat checks. */
function recordJev() {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) return;
  const jev = new TypeSafeClient({
    apiKey,
    retry: { maxRetries: 0 },
    logLevel: "warn",
  });
  const recorder: SystemOne = {
    systemOne: (async (...args: Parameters<SystemOne["systemOne"]>) => {
      const out = await jev.systemOne(...args);
      const { state } = args[0] as unknown as { state: { question: string } };
      const { answers } = out as unknown as {
        answers: { unnamedSubject: { noul: number } };
      };
      seen.jev.push({
        question: state.question,
        noul: answers.unnamedSubject.noul,
      });
      return out;
    }) as SystemOne["systemOne"],
  };
  globalThis.SYSTEM_ONE_CLIENT = recorder;
}

describe.skipIf(!process.env.AI_GATEWAY_API_KEY)("team FAQ @live", () => {
  beforeAll(async () => {
    recordJev();
    for (const file of FILES)
      for (const proposal of await upload(file))
        await confirm(proposal, path.basename(file));
    const [team] = await db
      .execute<{ id: string }>(
        sql`select id from workspaces where kind = 'team'`,
      )
      .then((r) => r.rows);
    workspaceId = team.id;
    for (const [question, message] of CORRECTIONS) {
      const parts = await chat(question);
      seen.seeding.push({
        asked: question,
        answer: answerOf(parts),
        cited: parts
          .filter((p) => p.type === "data-citation")
          .map((p) => (p.data as { text: string }).text),
      });
      const proposals = (await chat(message, { question, parts }))
        .filter((p) => p.type === "data-proposal")
        .map((p) => p.data as Proposal);
      if (!proposals.length) seen.seeding.push({ from: message, none: true });
      for (const proposal of proposals) await confirm(proposal, message);
    }
    const pending = await upload(PENDING_FILE);
    seen.seeding.push({
      from: path.basename(PENDING_FILE),
      left: "待確認",
      items: pending.flatMap((p) => p.items.map((i) => i.content)),
    });
  });

  afterAll(async () => {
    if (!workspaceId) return;
    mkdirSync(REPORT, { recursive: true });
    const report = await reidentify(workspaceId, {
      ...seen,
      thresholds: await thresholds(),
    });
    writeFileSync(
      path.join(REPORT, "report.json"),
      JSON.stringify(report, null, 2),
    );
    globalThis.SYSTEM_ONE_CLIENT = undefined;
  });

  for (const entry of TEAM_FAQ)
    it(`${entry.id} (${entry.tests}): ${entry.question}`, async () => {
      const parts = await chat(entry.question);
      const reply: Reply = {
        text: answerOf(parts),
        citations: parts
          .filter((p) => p.type === "data-citation")
          .map((p) => p.data as Reply["citations"][number]),
      };
      const [question] = await pseudonymize(workspaceId, [entry.question]);
      const retrieved = (
        await new KnowledgeRetriever({ workspaceId }).invoke(question)
      ).map((d) => d.metadata);
      // The graph lane's own candidates, before fusion keeps the top 6.
      const graph = (await searchGraph(workspaceId, question, 20)).map(
        (match, rank) => ({
          content: match.content,
          hops: match.hops,
          lanes: { graph: rank + 1 },
        }),
      );
      const { similarity } = await retrieve({
        workspaceId,
        turns: [],
        message: question,
      });
      const failures = grade(entry, reply, [...retrieved, ...graph]);
      seen.answers.push({
        id: entry.id,
        question: entry.question,
        failures,
        text: reply.text,
        citations: reply.citations.map((c) => c.label),
        similarity,
        retrieved: retrieved.map((r) => ({
          content: r.content,
          lanes: r.lanes,
          keyword: r.keyword,
          similarity: r.similarity,
          named: r.named,
        })),
        graph,
      });
      expect(failures, reply.text).toEqual([]);
    });

  it("scores the subject of unnamed first questions (Jev threshold)", async () => {
    if (!process.env.JEV_API_KEY) return;
    for (const message of UNNAMED)
      await checkSubject({ turns: [], message, attachments: 0 });
    expect(seen.jev.length).toBeGreaterThan(0);
  });

  // PLACEHOLDER (#40, acceptance criterion 3): the first real meeting
  // transcript, de-identified, goes into fixtures with its expected facts;
  // this then grades what the 輸入 subgraph extracts from it. Waiting for
  // Jason to record and supply the transcript.
  it.skip("extracts the expected facts from the first real meeting transcript", () => {});
});

/**
 * The calibration still owed (notes 27, 31, 32, 33) measured on this
 * knowledge base: cosines between facts (RELATED_AT, SAME_CLAIM_AT),
 * between entity names (CANDIDATE_AT), and word_similarity of each question
 * to the facts (keyword lane's 0.2).
 */
async function thresholds() {
  const rows = async <T>(query: ReturnType<typeof sql>) =>
    (await db.execute(query)).rows as T[];
  const pairs = await rows<{ a: string; b: string; cos: number }>(sql`
    select a.content a, b.content b, 1 - (a.embedding <=> b.embedding) cos
    from facts a join facts b on a.id < b.id
      and a.workspace_id = b.workspace_id and a.status <> 'rejected' and b.status <> 'rejected'
    where a.workspace_id = ${workspaceId} order by cos desc`);
  const cosines = pairs.map((p) => Number(p.cos));
  const at = (q: number) => cosines[Math.floor((1 - q) * (cosines.length - 1))];
  const names = await rows<{ a: string; b: string; cos: number }>(sql`
    select a.name a, b.name b, 1 - (a.embedding <=> b.embedding) cos
    from entities a join entities b on a.id < b.id and a.workspace_id = b.workspace_id
    where a.workspace_id = ${workspaceId} order by cos desc limit 30`);
  const aliases = await rows<{ entity: string; alias: string }>(sql`
    select e.name entity, a.name alias from entity_aliases a
    join entities e on e.id = a.entity_id where e.workspace_id = ${workspaceId}`);
  const keyword = [];
  for (const entry of TEAM_FAQ) {
    const [q] = await pseudonymize(workspaceId, [entry.question]);
    const top = await rows<{ content: string; ws: number }>(sql`
      select content, word_similarity(${q}, content) ws from facts
      where workspace_id = ${workspaceId} and status = 'confirmed' and valid_to is null
      order by ws desc limit 5`);
    keyword.push({
      id: entry.id,
      top: top.map((t) => ({ ws: Number(t.ws), content: t.content })),
    });
  }
  return {
    facts: {
      RELATED_AT,
      SAME_CLAIM_AT,
      pairs: cosines.length,
      atLeastRelated: cosines.filter((c) => c >= RELATED_AT).length,
      atLeastSameClaim: cosines.filter((c) => c >= SAME_CLAIM_AT).length,
      percentiles: { p50: at(0.5), p90: at(0.9), p99: at(0.99) },
      top: pairs.slice(0, 25).map((p) => ({ ...p, cos: Number(p.cos) })),
    },
    entities: {
      CANDIDATE_AT,
      top: names.map((n) => ({ ...n, cos: Number(n.cos) })),
      aliases,
    },
    keyword: { MIN_KEYWORD: 0.2, questions: keyword },
  };
}
