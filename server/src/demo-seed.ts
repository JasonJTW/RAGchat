import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, getTableColumns, is, ne, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "./db.js";
import * as schema from "./db/schema.js";
import { workspaces } from "./db/schema.js";
import {
  confirmProposal,
  type Correction,
  propose,
  type Proposal,
} from "./knowledge-base.js";
import { embeddings } from "./models.js";
import { chunkSource } from "./source-files.js";

// 示範資料: the fictional team's sources and facts every 試用工作區 starts
// with (server/demo-data/README.md). Seeding a trial never calls a model. The
// facts are written out below, drawn from the seed files by hand, so no chat
// model extracts them; and they are proposed and confirmed once, into a
// template workspace (kind `demo`), the one time their embeddings are made.
// Each trial is then a copy of the template's rows, in SQL. A new embedding
// model or a change to the seed builds a new template.

const SEED_DIR = path.join(import.meta.dirname, "../demo-data/seed");

/** Who proposed and confirmed the 示範資料 (shown as such on its facts). */
export const DEMO_USER = "示範資料";

/** A fact of a seed file: its text and a phrase of the passage it is from. */
interface SeedFact {
  key: string;
  content: string;
  from: string;
}

/** A seed file's 取代 or 過時 of an earlier seed fact. */
type SeedCorrection = {
  target: string;
  reason: string;
  effectiveAt: string;
} & (
  | { kind: "supersede"; key: string; content: string; from: string }
  | { kind: "obsolete" }
);

interface SeedSource {
  filename: string;
  /** When it was given (Asia/Taipei midnight). */
  createdAt: string;
  facts: SeedFact[];
  corrections?: SeedCorrection[];
}

const SEED: SeedSource[] = [
  {
    filename: "01-wiki-avoided-emissions.md",
    createdAt: "2026-03-01T16:00:00.000Z",
    facts: [
      {
        key: "formula",
        content:
          "避免排放公式為 A = W × EF × R（A：每筆交換的避免排放量 kgCO2e；W：物品重量 kg；EF：類別新品生產排放係數；R：取代率）",
        from: "A = W × EF × R",
      },
      {
        key: "r",
        content: "取代率 R 所有類別統一為 0.7",
        from: "R**：取代率",
      },
      {
        key: "ef",
        content:
          "類別排放係數 EF（kgCO2e/kg）：木製家具 1.8、衣物與布料 15.0、小家電 6.5、書籍與紙類 1.2、兒童用品 4.0",
        from: "| 木製家具",
      },
      {
        key: "report",
        content:
          "每月 5 日前由張小石把上個月的交換與避免排放量匯出成 CSV，寄給霧橋市循環經濟辦公室",
        from: "每月 5 日以前",
      },
      {
        key: "owner",
        content: "避免排放算法（公式與係數）的負責人是林小樹",
        from: "公式與係數：林小樹",
      },
      {
        key: "display-owner",
        content: "交換完成頁的避免排放顯示由陳小葉負責",
        from: "交換完成頁的顯示：陳小葉",
      },
      {
        key: "alias",
        content: "「減碳計算模型」是「避免排放算法」的別名",
        from: "好物輪轉是霧橋市的物資交換平台",
      },
    ],
  },
  {
    filename: "02-meeting-2026-05-14.txt",
    createdAt: "2026-05-13T16:00:00.000Z",
    corrections: [
      {
        kind: "supersede",
        target: "formula",
        key: "formula-l",
        content:
          "避免排放公式為 A = W × EF × R × L，L 為壽命比（二手物品預估剩餘壽命 ÷ 新品壽命）",
        from: "壽命比 L",
        reason:
          "2026-05-14 週會決議：二手物品剩餘壽命比新品短，原公式高估取代的新品量，尤其衣物",
        effectiveAt: "2026-05-17T16:00:00.000Z",
      },
      {
        kind: "obsolete",
        target: "report",
        reason:
          "社區減碳試辦計畫 2026-06 底結束、不延長；六月的報表是最後一份，七月起停止寄送",
        effectiveAt: "2026-06-30T16:00:00.000Z",
      },
    ],
    facts: [
      {
        key: "l",
        content: "壽命比 L 預設 0.5；刊登時勾選「全新未使用」的物品 L 為 1",
        from: "預設 0.5",
      },
      {
        key: "why-l",
        content:
          "公式加入壽命比 L 的理由：二手物品的剩餘壽命比新品短，原公式高估了它取代的新品量，尤其是衣物",
        from: "高估",
      },
      {
        key: "transport",
        content:
          "待解問題：避免排放是否扣除取件的運送排放、距離怎麼估，尚未決定",
        from: "待解問題",
      },
    ],
  },
  {
    filename: "03-repo-weekly-2026-05-18.md",
    createdAt: "2026-05-17T16:00:00.000Z",
    facts: [
      {
        key: "done-note",
        content:
          "交換完成頁的避免排放數字下方顯示「已考慮二手物品的剩餘壽命」（PR #213）",
        from: "已考慮二手物品的剩餘壽命",
      },
      {
        key: "map-radius",
        content:
          "地圖搜尋頁可依半徑（1、3、5、10 公里）篩選刊登物品（PR #209）",
        from: "半徑篩選",
      },
      {
        key: "brand-new",
        content: "刊登表單有「全新未使用」勾選框（PR #214）",
        from: "全新未使用",
      },
    ],
  },
];

const seedText = (filename: string) =>
  readFileSync(path.join(SEED_DIR, filename), "utf8");

// Changes whenever the seed (facts or files) does, so a changed seed gets a
// new template.
const SEED_VERSION = createHash("sha256")
  .update(JSON.stringify(SEED))
  .update(SEED.map((source) => seedText(source.filename)).join("\f"))
  .digest("hex")
  .slice(0, 12);

/** Copies the 示範資料 into an empty workspace, within the transaction. */
export async function copyDemoSeed(tx: Tx, workspaceId: string) {
  const template = await demoTemplate();
  await copyWorkspace(tx, template, workspaceId);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const templates = new Map<string, Promise<string>>();

// The template for the current embedding model: found, or built once. It is
// built while holding a lock (its rows go in through other connections), so
// another server waits and then finds it. Older templates, and one whose
// build failed, are deleted; trials copied from them keep their rows.
function demoTemplate(): Promise<string> {
  const name = `示範資料 ${SEED_VERSION} · ${embeddings().model}`;
  let template = templates.get(name);
  if (!template) {
    template = db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('demo template'))`,
        );
        const [found] = await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(eq(workspaces.kind, "demo"), eq(workspaces.name, name)));
        if (found) return found.id;
        await tx
          .delete(workspaces)
          .where(and(eq(workspaces.kind, "demo"), ne(workspaces.name, name)));
        const [building] = await db
          .insert(workspaces)
          .values({ kind: "demo", name: `${name} (building)` })
          .returning({ id: workspaces.id });
        await buildSeed(building.id);
        await db
          .update(workspaces)
          .set({ name })
          .where(eq(workspaces.id, building.id));
        return building.id;
      })
      .catch((error: unknown) => {
        templates.delete(name);
        throw error;
      });
    templates.set(name, template);
  }
  return template;
}

// Proposes and confirms each seed file in date order, as a member would.
async function buildSeed(workspaceId: string) {
  const factIds = new Map<string, string>();
  for (const source of SEED) {
    const content = seedText(source.filename);
    const chunks = chunkSource(source.filename, content);
    const chunkOf = (from: string) => {
      const i = chunks.findIndex((chunk) => chunk.embedText.includes(from));
      if (i < 0) throw new Error(`no passage of ${source.filename}: ${from}`);
      return i;
    };
    const corrections = (source.corrections ?? []).map((c): Correction => ({
      ...(c.kind === "supersede"
        ? { kind: "supersede", content: c.content }
        : { kind: "obsolete" }),
      targetFactId: factIds.get(c.target)!,
      reason: c.reason,
      effectiveAt: c.effectiveAt,
    }));
    const proposal = await propose(workspaceId, DEMO_USER, {
      source: {
        kind: "file",
        filename: source.filename,
        content,
        createdAt: new Date(source.createdAt),
      },
      chunks,
      facts: source.facts.map((fact) => ({
        content: fact.content,
        chunk: chunkOf(fact.from),
      })),
      corrections,
    });
    const confirmed = await confirmProposal(
      workspaceId,
      proposal.id,
      DEMO_USER,
    );
    if (typeof confirmed !== "object" || !("items" in confirmed))
      throw new Error(`the 示範資料 ${source.filename} was not confirmed`);
    const added = [
      ...(source.corrections ?? []).flatMap((c) =>
        c.kind === "supersede" ? [c] : [],
      ),
      ...source.facts,
    ];
    for (const fact of added)
      factIds.set(fact.key, factIdOf(confirmed, fact.content));
  }
}

const factIdOf = (proposal: Proposal, content: string) =>
  proposal.items.find((item) => item.content === content)!.factId!;

/**
 * The tables a workspace's knowledge base lives in: those with a
 * `workspace_id`, but not conversations, which are a user's, not the seed.
 * Ordered so that a table comes after those it refers to.
 */
export function workspaceTables(): PgTable[] {
  const tables = (Object.values(schema) as unknown[]).filter(
    (value): value is PgTable =>
      is(value, PgTable) &&
      value !== (schema.conversations as PgTable) &&
      "workspaceId" in getTableColumns(value),
  );
  const ordered: PgTable[] = [];
  const pending = [...tables];
  while (pending.length) {
    const next = pending.findIndex((table) =>
      referencedTables(table).every(
        (other) => other === table || !pending.includes(other),
      ),
    );
    if (next < 0) throw new Error("workspace tables refer to each other");
    ordered.push(...pending.splice(next, 1));
  }
  return ordered;
}

function referencedTables(table: PgTable): PgTable[] {
  return getTableConfig(table).foreignKeys.map(
    (fk) => fk.reference().foreignTable,
  );
}

// Copies every row of one workspace into another, each under a new id, its
// references to other copied rows re-pointed to their copies. A table's rows
// go in one statement, so rows that refer to each other (a fact's
// superseded_by) are checked once all are in.
async function copyWorkspace(tx: Tx, from: string, to: string) {
  const tables = workspaceTables();
  await tx.execute(
    sql`create temp table copied_ids (old uuid primary key, new uuid not null default gen_random_uuid()) on commit drop`,
  );
  for (const table of tables) {
    const { name } = getTableConfig(table);
    await tx.execute(
      sql`insert into copied_ids (old) select id from ${sql.identifier(name)} where workspace_id = ${from}`,
    );
  }
  for (const table of tables) {
    const { name, columns, foreignKeys } = getTableConfig(table);
    const remapped = new Set(
      foreignKeys
        .map((fk) => fk.reference())
        .filter((ref) => ref.foreignTable !== workspaces)
        .flatMap((ref) => ref.columns.map((column) => column.name)),
    );
    const names = columns.map((column) => column.name);
    if (!names.includes("id"))
      throw new Error(`${name} has no id column to copy by`);
    const values = names.map((column) =>
      column === "workspace_id"
        ? sql`${to}::uuid`
        : column === "id" || remapped.has(column)
          ? sql`(select new from copied_ids where old = t.${sql.identifier(column)})`
          : sql`t.${sql.identifier(column)}`,
    );
    await tx.execute(
      sql`insert into ${sql.identifier(name)} (${sql.join(
        names.map((column) => sql.identifier(column)),
        sql`, `,
      )}) select ${sql.join(values, sql`, `)} from ${sql.identifier(name)} t where t.workspace_id = ${from}`,
    );
  }
}
