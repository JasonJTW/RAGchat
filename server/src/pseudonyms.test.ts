import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./db.js";
import { pseudonyms } from "./db/schema.js";
import {
  DeidentificationUnavailable,
  listTerms,
  markTerm,
  pseudonymize,
  pseudonymizeKnown,
  reidentifier,
  reidentify,
  unmarkExcluded,
} from "./pseudonyms.js";
import { createWorkspace } from "./workspaces.js";

// De-identification as the rest of the server uses it, on the local analyzer
// (vitest.setup.ts) and real Postgres. Each test has a team workspace of its
// own; a guest workspace is never de-identified.
let ws: string;
const key = process.env.PSEUDONYM_ENCRYPTION_KEY;

beforeEach(async () => {
  ws = await createWorkspace("team", "test");
});
afterEach(() => {
  process.env.PSEUDONYM_ENCRYPTION_KEY = key;
});

describe("pseudonymize", () => {
  it("replaces a detected value with a pseudonym of its kind", async () => {
    const [text] = await pseudonymize(ws, [
      "王小明先生的手機是 0912-345-678。",
    ]);
    expect(text).toBe("〔人名1〕先生的手機是 〔電話1〕。");
  });

  it("gives the same value the same pseudonym in every later text", async () => {
    const [first] = await pseudonymize(ws, ["王小明先生負責倉庫。"]);
    const [second, third] = await pseudonymize(ws, [
      "會議由王小明先生主持。",
      // Found again without its title: a known value is always replaced.
      "王小明說下週交報告。",
    ]);
    expect(first).toBe("〔人名1〕先生負責倉庫。");
    expect(second).toBe("會議由〔人名1〕先生主持。");
    expect(third).toBe("〔人名1〕說下週交報告。");
  });

  it("numbers different values of a kind apart", async () => {
    const [text] = await pseudonymize(ws, ["王小明先生和陳大文先生"]);
    expect(text).toBe("〔人名1〕先生和〔人名2〕先生");
  });

  it("keeps pseudonyms per workspace", async () => {
    await pseudonymize(ws, ["陳大文先生"]);
    const other = await createWorkspace("team", "other");
    const [text] = await pseudonymize(other, ["王小明先生"]);
    expect(text).toBe("〔人名1〕先生");
  });

  it("leaves text already pseudonymised as it is", async () => {
    const [once] = await pseudonymize(ws, ["王小明先生付了 3 萬元"]);
    const [twice] = await pseudonymize(ws, [once]);
    expect(twice).toBe(once);
  });

  it("never force-matches a one-character value elsewhere", async () => {
    await pseudonymize(ws, ["請林經理回覆"]);
    const [text] = await pseudonymize(ws, ["樹林站的回收箱"]);
    expect(text).toBe("樹林站的回收箱");
  });

  it("stores no value in the clear", async () => {
    await pseudonymize(ws, ["王小明先生，jason@example.com"]);
    const rows = await db
      .select()
      .from(pseudonyms)
      .where(eq(pseudonyms.workspaceId, ws));
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("王小明");
    expect(dump).not.toContain("jason@example.com");
  });

  it("leaves a guest workspace's text as it is", async () => {
    const guest = await createWorkspace("guest", "trial");
    expect(await pseudonymize(guest, ["王小明先生"])).toEqual(["王小明先生"]);
  });

  it("refuses to work without the key", async () => {
    delete process.env.PSEUDONYM_ENCRYPTION_KEY;
    await expect(pseudonymize(ws, ["王小明先生"])).rejects.toThrow(
      DeidentificationUnavailable,
    );
  });

  it("refuses to work when the analyzer can't look", async () => {
    const analyzer = globalThis.PII_ANALYZER;
    globalThis.PII_ANALYZER = {
      analyze: () => Promise.reject(new Error("down")),
    };
    try {
      await expect(pseudonymize(ws, ["王小明先生"])).rejects.toThrow(
        DeidentificationUnavailable,
      );
    } finally {
      globalThis.PII_ANALYZER = analyzer;
    }
  });
});

describe("the pseudonym table without its key", () => {
  it("can't be read with another key", async () => {
    await pseudonymize(ws, ["王小明先生"]);
    process.env.PSEUDONYM_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    await expect(reidentify(ws, "〔人名1〕先生")).rejects.toThrow(
      DeidentificationUnavailable,
    );
  });
});

describe("reidentify", () => {
  it("puts the values back into every string of a value", async () => {
    const [content] = await pseudonymize(ws, ["王小明先生付了 3 萬元"]);
    expect(
      await reidentify(ws, { items: [{ content, n: 1 }], note: null }),
    ).toEqual({
      items: [{ content: "王小明先生付了 3 萬元", n: 1 }],
      note: null,
    });
  });

  it("leaves an unknown pseudonym as it is", async () => {
    expect(await reidentify(ws, "〔人名9〕說")).toBe("〔人名9〕說");
  });
});

describe("reidentifier", () => {
  it("never splits a pseudonym across streamed deltas", async () => {
    const [text] = await pseudonymize(ws, ["王小明先生負責"]);
    const stream = await reidentifier(ws);
    let out = "";
    for (const char of text) out += await stream.text("a", char);
    out += await stream.end("a");
    expect(out).toBe("王小明先生負責");
  });

  it("holds back only what could still become a pseudonym", async () => {
    await pseudonymize(ws, ["王小明先生"]);
    const stream = await reidentifier(ws);
    expect(await stream.text("a", "看〔人")).toBe("看");
    expect(await stream.text("a", "名1〕先生")).toBe("王小明先生");
    expect(await stream.text("b", "〔 不是代稱")).toBe("〔 不是代稱");
  });

  it("finds pseudonyms made after it started", async () => {
    const stream = await reidentifier(ws);
    await pseudonymize(ws, ["陳大文先生"]);
    expect(await stream.text("a", "〔人名1〕好")).toBe("陳大文好");
  });
});

describe("pseudonymizeKnown", () => {
  it("replaces values already in the table, in every string", async () => {
    await pseudonymize(ws, ["王小明先生"]);
    expect(
      await pseudonymizeKnown(ws, [{ parts: [{ text: "問王小明吧" }] }]),
    ).toEqual([{ parts: [{ text: "問〔人名1〕吧" }] }]);
  });
});

describe("marked terms", () => {
  it("pseudonymises a term marked sensitive in later text", async () => {
    await markTerm(ws, "member-a", "阿德", true);
    const [text] = await pseudonymize(ws, ["阿德說要改公式"]);
    expect(text).toBe("〔敏感詞1〕說要改公式");
    expect(await reidentify(ws, text)).toBe("阿德說要改公式");
  });

  it("never pseudonymises a term marked not sensitive", async () => {
    await markTerm(ws, "member-a", "高老師", false);
    const [text] = await pseudonymize(ws, ["高老師的課"]);
    expect(text).toBe("高老師的課");
  });

  it("stops excluding a term taken off the list", async () => {
    await markTerm(ws, "member-a", "高老師", false);
    await unmarkExcluded(ws, "高老師");
    const [text] = await pseudonymize(ws, ["高老師的課"]);
    expect(text).toBe("〔人名1〕老師的課");
  });

  it("lists both lists", async () => {
    await pseudonymize(ws, ["王小明先生"]);
    await markTerm(ws, "member-a", "阿德", true);
    await markTerm(ws, "member-a", "回收率", false);
    expect(await listTerms(ws)).toEqual({
      sensitive: ["王小明", "阿德"],
      excluded: ["回收率"],
    });
  });

  it("moves a term between the lists", async () => {
    await markTerm(ws, "member-a", "阿德", false);
    await markTerm(ws, "member-a", "阿德", true);
    expect(await listTerms(ws)).toEqual({ sensitive: ["阿德"], excluded: [] });
    const [text] = await pseudonymize(ws, ["阿德"]);
    expect(text).toBe("〔敏感詞1〕");
  });
});
