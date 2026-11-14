import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "./db.js";
import { excludedTerms, pseudonyms, workspaces } from "./db/schema.js";
import { piiAnalyzer } from "./pii-analyzer.js";
import { deidentifies } from "./trial.js";

// 去識別 (ADR-0004). Before any text reaches a model, an embedding or a
// table, each sensitive value in it is replaced by its pseudonym (〔人名3〕),
// the same one everywhere in the workspace; questions too, so retrieval finds
// facts by a real name. The values are only in the pseudonym table, each
// AES-256-GCM encrypted with PSEUDONYM_ENCRYPTION_KEY; they are put back just
// before a 成員 sees the text.
//
// What counts as sensitive: what the analyzer (pii-analyzer.ts) finds, every
// value already in the table, and the terms a 成員 marked sensitive; minus
// the terms marked not sensitive (排除詞). A guest's trial workspace holds
// only made-up demo data and is never de-identified.
//
// Fails closed: without the key, or when the analyzer can't look, every call
// throws DeidentificationUnavailable rather than pass text on unchecked.

/** De-identification can't run now: the key is missing or wrong, or the analyzer is down. */
export class DeidentificationUnavailable extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`de-identification unavailable: ${reason}`, options);
    this.name = "DeidentificationUnavailable";
  }
}

/** The reply when an input or a question can't be de-identified now. */
export const UNAVAILABLE_REPLY =
  "去識別服務暫時無法使用，為了保護敏感內容，這則訊息沒有送出。請稍後再試。";

/** Every pseudonym looks like this: 〔kind + number〕. */
const PSEUDONYM = /〔[^〔〕\s]{1,8}?\d{1,6}〕/g;
// The longest a pseudonym can be, for holding back a streamed one.
const MAX_PSEUDONYM_LENGTH = 16;
// Known values shorter than this (a lone surname, 「林經理」's 林) are only
// replaced where the analyzer finds them, never wherever the character is.
const MIN_KNOWN_LENGTH = 2;

/**
 * The texts with each sensitive value replaced by its pseudonym; values new
 * to the workspace get one first.
 */
export async function pseudonymize(
  workspaceId: string,
  texts: string[],
): Promise<string[]> {
  if (await isGuest(workspaceId)) return texts;
  const [known, excluded] = await Promise.all([
    knownValues(workspaceId),
    excludedOf(workspaceId),
  ]);
  const analyzer = piiAnalyzer();
  const found = await Promise.all(
    texts.map((text) =>
      analyzer.analyze(text).catch((error: unknown) => {
        throw new DeidentificationUnavailable("the analyzer failed", {
          cause: error,
        });
      }),
    ),
  );
  // A value found anywhere in these texts counts as known in all of them.
  const fresh = found.flatMap((spans, i) =>
    spans.map((span) => ({
      pseudonym: "",
      kind: span.kind,
      value: texts[i].slice(span.start, span.end),
    })),
  );
  const spans = texts.map((text, i) =>
    resolve(
      text,
      [...found[i], ...knownSpans(text, [...known, ...fresh])],
      excluded,
    ),
  );
  const values = spans.flatMap((list, i) =>
    list.map((span) => ({
      value: texts[i].slice(span.start, span.end),
      kind: span.kind,
    })),
  );
  const pseudonymOf = await pseudonymsFor(workspaceId, values);
  return texts.map((text, i) =>
    replaceSpans(text, spans[i], (value) => pseudonymOf.get(hashOf(value))!),
  );
}

/**
 * The value with the values already in the table replaced by their
 * pseudonyms in every string; finds nothing new. For text that went through
 * `pseudonymize` and back, e.g. a conversation being saved.
 */
export async function pseudonymizeKnown<T>(
  workspaceId: string,
  value: T,
): Promise<T> {
  if (await isGuest(workspaceId)) return value;
  const [known, excluded] = await Promise.all([
    knownValues(workspaceId),
    excludedOf(workspaceId),
  ]);
  const pseudonymOf = new Map(known.map((k) => [hashOf(k.value), k.pseudonym]));
  return mapStrings(value, (text) =>
    replaceSpans(
      text,
      resolve(text, knownSpans(text, known), excluded),
      (found) => pseudonymOf.get(hashOf(found))!,
    ),
  );
}

/** The value with each pseudonym in its strings replaced by its value. */
export async function reidentify<T>(workspaceId: string, value: T): Promise<T> {
  return (await reidentifier(workspaceId)).value(value);
}

/**
 * Puts values back into a reply as it streams. A pseudonym split across
 * deltas is held back until it is whole, so pass each text part's deltas to
 * `text` and call `end` when the part ends.
 */
export interface Reidentifier {
  /** What of the text part can be shown now. */
  text(id: string, delta: string): Promise<string>;
  /** The rest of the text part. */
  end(id: string): Promise<string>;
  /** A whole value, e.g. a proposal card. */
  value<T>(value: T): Promise<T>;
}

export async function reidentifier(workspaceId: string): Promise<Reidentifier> {
  const guest = await isGuest(workspaceId);
  let values = guest ? new Map<string, string>() : await valuesOf(workspaceId);
  // Pseudonyms made after the reply started (a file input's) load on sight;
  // one the table has never had is looked up once.
  const missed = new Set<string>();
  const fill = async (text: string) => {
    if (guest) return text;
    const unknown = (text.match(PSEUDONYM) ?? []).filter(
      (p) => !values.has(p) && !missed.has(p),
    );
    if (unknown.length) {
      values = await valuesOf(workspaceId);
      for (const p of unknown) if (!values.has(p)) missed.add(p);
    }
    return text.replace(PSEUDONYM, (p) => values.get(p) ?? p);
  };
  const held = new Map<string, string>();
  return {
    async text(id, delta) {
      const text = (held.get(id) ?? "") + delta;
      const open = text.lastIndexOf("〔");
      const partial =
        open >= 0 &&
        !text.includes("〕", open) &&
        text.length - open < MAX_PSEUDONYM_LENGTH &&
        /^〔[^〔〕\s]*$/.test(text.slice(open));
      held.set(id, partial ? text.slice(open) : "");
      return fill(partial ? text.slice(0, open) : text);
    },
    async end(id) {
      const rest = held.get(id) ?? "";
      held.delete(id);
      return fill(rest);
    },
    async value(value) {
      const strings: string[] = [];
      mapStrings(value, (s) => (strings.push(s), s));
      await fill(strings.join("\n"));
      return mapStrings(value, (s) =>
        guest ? s : s.replace(PSEUDONYM, (p) => values.get(p) ?? p),
      );
    },
  };
}

/** The terms a 成員 can see as marked: sensitive values (oldest first) and 排除詞. */
export async function listTerms(
  workspaceId: string,
): Promise<{ sensitive: string[]; excluded: string[] }> {
  const [known, excluded] = await Promise.all([
    knownValues(workspaceId),
    db
      .select({ term: excludedTerms.term })
      .from(excludedTerms)
      .where(eq(excludedTerms.workspaceId, workspaceId))
      .orderBy(asc(excludedTerms.createdAt)),
  ]);
  const ex = new Set(excluded.map((e) => normalize(e.term)));
  return {
    sensitive: known
      .map((k) => k.value)
      .filter((value) => !ex.has(normalize(value))),
    excluded: excluded.map((e) => e.term),
  };
}

/**
 * Marks a term sensitive (it gets a pseudonym and is replaced in all later
 * input) or not sensitive (a 排除詞, never replaced). Either takes it off the
 * other list. Text stored before keeps what it had.
 */
export async function markTerm(
  workspaceId: string,
  userId: string,
  term: string,
  sensitive: boolean,
): Promise<void> {
  const value = term.trim();
  if (sensitive) {
    await unmarkExcluded(workspaceId, value);
    await pseudonymsFor(workspaceId, [{ value, kind: SENSITIVE_KIND }]);
  } else {
    await db
      .insert(excludedTerms)
      .values({ workspaceId, term: value, createdBy: userId })
      .onConflictDoNothing();
  }
}

/** Takes a term off the 排除詞 list: the analyzer decides about it again. */
export async function unmarkExcluded(
  workspaceId: string,
  term: string,
): Promise<void> {
  await db
    .delete(excludedTerms)
    .where(
      and(
        eq(excludedTerms.workspaceId, workspaceId),
        eq(excludedTerms.term, term.trim()),
      ),
    );
}

// The kind of a term a 成員 marked 敏感.
const SENSITIVE_KIND = "敏感詞";
// Tables that hold no pseudonymised text.
const NO_PSEUDONYMS = ["pseudonyms", "excluded_terms", "deletions"];

/**
 * Deletes the pseudonyms in the texts that no row of the workspace uses any
 * more, e.g. after a 來源 holding them was hard-deleted in this transaction.
 * 敏感詞 a 成員 marked stay. Searches every text column of every workspace
 * table, so a new table is covered without a change here.
 */
export async function forgetUnused(
  tx: Tx,
  workspaceId: string,
  texts: string[],
) {
  const candidates = [
    ...new Set(texts.flatMap((text) => text.match(PSEUDONYM) ?? [])),
  ];
  if (candidates.length === 0) return;
  // Taken as pseudonymize takes it, so no new text gets one mid-check.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`pseudonyms:${workspaceId}`}))`,
  );
  const { rows: columns } = await tx.execute<{
    table_name: string;
    column_name: string;
  }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    where c.table_schema = current_schema()
      and c.data_type in ('text', 'jsonb', 'ARRAY')
      and c.table_name not in (${sql.join(
        NO_PSEUDONYMS.map((t) => sql`${t}`),
        sql`, `,
      )})
      and exists (
        select 1 from information_schema.columns w
        where w.table_schema = c.table_schema and w.table_name = c.table_name
          and w.column_name = 'workspace_id'
      )
  `);
  const byTable = new Map<string, string[]>();
  for (const c of columns)
    byTable.set(c.table_name, [
      ...(byTable.get(c.table_name) ?? []),
      c.column_name,
    ]);
  const list = sql`array[${sql.join(
    candidates.map((p) => sql`${p}`),
    sql`, `,
  )}]::text[]`;
  const used = new Set<string>();
  for (const [table, cols] of byTable) {
    const { rows } = await tx.execute<{ p: string }>(sql`
      select c.p from unnest(${list}) c(p) where exists (
        select 1 from ${sql.identifier(table)} t
        where t.workspace_id = ${workspaceId} and (${sql.join(
          cols.map(
            (col) => sql`strpos(t.${sql.identifier(col)}::text, c.p) > 0`,
          ),
          sql` or `,
        )})
      )
    `);
    for (const row of rows) used.add(row.p);
  }
  const unused = candidates.filter((p) => !used.has(p));
  if (unused.length)
    await tx.execute(sql`
      delete from pseudonyms
      where workspace_id = ${workspaceId} and kind <> ${SENSITIVE_KIND}
        and pseudonym in (${sql.join(
          unused.map((p) => sql`${p}`),
          sql`, `,
        )})
    `);
}

// --- Finding what to replace ---

interface Span {
  start: number;
  end: number;
  kind: string;
}

interface Known {
  pseudonym: string;
  kind: string;
  value: string;
}

// Where the known values occur in the text, ignoring case.
function knownSpans(text: string, known: Known[]): Span[] {
  const lower = text.toLowerCase();
  const haystack = lower.length === text.length ? lower : text;
  return known.flatMap(({ value, kind }) => {
    if ([...value].length < MIN_KNOWN_LENGTH) return [];
    const needle = haystack === lower ? value.toLowerCase() : value;
    const spans: Span[] = [];
    for (
      let at = haystack.indexOf(needle);
      at >= 0;
      at = haystack.indexOf(needle, at + needle.length)
    )
      spans.push({ start: at, end: at + needle.length, kind });
    return spans;
  });
}

// The spans to replace: none inside a pseudonym or a 排除詞, none of a
// 排除詞 itself, and the longest where spans overlap.
function resolve(text: string, spans: Span[], excluded: string[]): Span[] {
  const kept: Span[] = [
    ...[...text.matchAll(PSEUDONYM)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      kind: "",
    })),
    ...excluded.flatMap((term) => knownSpans(text, [{ value: term } as Known])),
  ];
  const ex = new Set(excluded.map(normalize));
  const chosen: Span[] = [];
  for (const span of [...spans].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  )) {
    if (span.end <= span.start) continue;
    if (ex.has(normalize(text.slice(span.start, span.end)))) continue;
    if (kept.some((k) => k.start <= span.start && span.end <= k.end)) continue;
    if ([...kept, ...chosen].some((k) => overlaps(k, span))) continue;
    chosen.push(span);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

function replaceSpans(
  text: string,
  spans: Span[],
  pseudonymOf: (value: string) => string,
): string {
  let out = "";
  let at = 0;
  for (const span of spans) {
    out +=
      text.slice(at, span.start) +
      pseudonymOf(text.slice(span.start, span.end));
    at = span.end;
  }
  return out + text.slice(at);
}

// Every string in a JSON-like value, replaced.
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value))
    return (value as unknown[]).map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]: [string, unknown]) => [
        k,
        mapStrings(v, fn),
      ]),
    ) as T;
  return value;
}

// --- The table ---

const kinds = new Map<string, Promise<boolean>>();

function isGuest(workspaceId: string): Promise<boolean> {
  let guest = kinds.get(workspaceId);
  if (!guest) {
    guest = db
      .select({ kind: workspaces.kind })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      // An unknown workspace is de-identified, to be safe.
      .then(([row]) => !deidentifies(row?.kind ?? "team"));
    guest.catch(() => kinds.delete(workspaceId));
    kinds.set(workspaceId, guest);
  }
  return guest;
}

async function knownValues(workspaceId: string): Promise<Known[]> {
  const rows = await db
    .select()
    .from(pseudonyms)
    .where(eq(pseudonyms.workspaceId, workspaceId))
    .orderBy(asc(pseudonyms.createdAt), asc(pseudonyms.pseudonym));
  const { encryption } = keys();
  return rows.map((row) => ({
    pseudonym: row.pseudonym,
    kind: row.kind,
    value: decrypt(
      encryption,
      row.valueCipher,
      aad(workspaceId, row.pseudonym),
    ),
  }));
}

async function valuesOf(workspaceId: string): Promise<Map<string, string>> {
  return new Map(
    (await knownValues(workspaceId)).map((k) => [k.pseudonym, k.value]),
  );
}

async function excludedOf(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ term: excludedTerms.term })
    .from(excludedTerms)
    .where(eq(excludedTerms.workspaceId, workspaceId));
  return rows.map((row) => row.term);
}

/**
 * The pseudonym of each value by its hash, creating the missing ones. The
 * lock numbers each kind's new pseudonyms one after another.
 */
async function pseudonymsFor(
  workspaceId: string,
  values: { value: string; kind: string }[],
): Promise<Map<string, string>> {
  const { encryption } = keys();
  const wanted = new Map(values.map((v) => [hashOf(v.value), v]));
  if (wanted.size === 0) return new Map();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pseudonyms:${workspaceId}`}))`,
    );
    const rows = await tx
      .select({
        pseudonym: pseudonyms.pseudonym,
        kind: pseudonyms.kind,
        valueHash: pseudonyms.valueHash,
      })
      .from(pseudonyms)
      .where(eq(pseudonyms.workspaceId, workspaceId));
    const found = new Map(rows.map((r) => [r.valueHash, r.pseudonym]));
    const next = new Map<string, number>();
    for (const row of rows) {
      const n = Number(/(\d+)〕$/.exec(row.pseudonym)?.[1] ?? 0);
      next.set(row.kind, Math.max(next.get(row.kind) ?? 0, n));
    }
    const created = [];
    for (const [valueHash, { value, kind }] of wanted) {
      if (found.has(valueHash)) continue;
      const n = (next.get(kind) ?? 0) + 1;
      next.set(kind, n);
      const pseudonym = `〔${kind}${n}〕`;
      found.set(valueHash, pseudonym);
      created.push({
        workspaceId,
        pseudonym,
        kind,
        valueHash,
        valueCipher: encrypt(encryption, value, aad(workspaceId, pseudonym)),
      });
    }
    if (created.length) await tx.insert(pseudonyms).values(created);
    return found;
  });
}

// --- Keys and encryption ---

// Each row's ciphertext is bound to its workspace and pseudonym, so a row
// copied onto another doesn't decrypt.
const aad = (workspaceId: string, pseudonym: string) =>
  Buffer.from(`${workspaceId}|${pseudonym}`);

let cached: { env: string; encryption: Buffer; index: Buffer } | undefined;

// Two keys derived from PSEUDONYM_ENCRYPTION_KEY: one encrypts values, one
// hashes them for lookup. Read from env on every call.
function keys(): { encryption: Buffer; index: Buffer } {
  const env = process.env.PSEUDONYM_ENCRYPTION_KEY ?? "";
  if (cached?.env === env) return cached;
  const key = Buffer.from(env, "base64");
  if (key.length !== 32)
    throw new DeidentificationUnavailable(
      "PSEUDONYM_ENCRYPTION_KEY must be 32 random bytes, base64",
    );
  const derive = (info: string) =>
    Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), info, 32));
  cached = {
    env,
    encryption: derive("ragchat pseudonym value"),
    index: derive("ragchat pseudonym index"),
  };
  return cached;
}

// The same for any spelling of one value: case, spaces, dashes, brackets.
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-()（）]/g, "");

const hashOf = (value: string) =>
  createHmac("sha256", keys().index).update(normalize(value)).digest("base64");

function encrypt(key: Buffer, value: string, aadBytes: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBytes);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function decrypt(key: Buffer, stored: string, aadBytes: Buffer): string {
  const bytes = Buffer.from(stored, "base64");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new DeidentificationUnavailable(
      "the pseudonym table doesn't decrypt with PSEUDONYM_ENCRYPTION_KEY",
      { cause: error },
    );
  }
}
