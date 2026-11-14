// The team FAQ answer set (ticket #40) and how an answer to it is graded.
//
// PROVISIONAL: these 10 questions are drafted by Claude from the spec (#22),
// the 示範資料 (server/demo-data/) and the kb-chatbot FAQ, standing in until
// Jason gives the team's 10 real frequent questions and their answers or
// grading rules. Replace TEAM_FAQ with those; keep `grade` as it is.
//
// The answers come from the knowledge base team-faq.live.test.ts seeds:
// the three seed files, the kb-chatbot faq.txt and 07-megaweaving-net-
// platform.md, confirmed, then the meeting's changes as members' 更正, then
// upload/meeting-2026-11-12.txt left 待確認.

/** What a question tests, beyond the answer's facts. */
export type FaqKind =
  | "current"
  | "reason"
  | "as-of"
  | "alias"
  | "graph hop"
  | "obsolete"
  | "pending"
  | "keyword"
  | "faq"
  | "refusal";

/**
 * A fact an answer must state: text, a pattern, or several ways of writing
 * it (any one matches). Text and patterns are compared against the answer
 * normalised (see `normalize`), so a pattern is written in that form.
 */
export type Expected = string | RegExp | (string | RegExp)[];

export interface FaqEntry {
  id: string;
  question: string;
  tests: FaqKind;
  /** Every one must be in the answer. */
  contains?: Expected[];
  /** None may be in the answer. */
  mustNotContain?: Expected[];
  /**
   * One citation must point to one of these: a file name or heading in its
   * label, or in the label of the passage its fact was drawn from.
   */
  cites?: string[];
  /**
   * The graph lane (walking from an entity the question names) must find a
   * confirmed fact containing this among its candidates.
   */
  viaGraph?: string;
  /** Why the question is here and where its answer is. */
  note?: string;
}

/** A streamed answer: its text and what it cites. */
export interface Reply {
  text: string;
  citations: {
    label: string;
    source?: { label?: string };
    proposal?: unknown;
  }[];
}

/** A fact the retriever returned, with the lanes that found it. */
export interface Retrieved {
  content: string;
  lanes: Partial<Record<"vector" | "keyword" | "graph" | "time", number>>;
}

const REFUSAL = "知識庫裡沒有這件事的資料";
const CLARIFY = "請問你指的是哪個計畫或主題？";
const PENDING = "待確認";

/**
 * Whatever an answer falls short of, one line each; empty when it passes.
 * `retrieved` is what the retriever found for the question (for viaGraph).
 */
export function grade(
  entry: FaqEntry,
  reply: Reply,
  retrieved: Retrieved[] = [],
): string[] {
  const failures: string[] = [];
  const text = normalize(reply.text);
  const has = (expected: Expected) =>
    (Array.isArray(expected) ? expected : [expected]).some((way) =>
      typeof way === "string" ? text.includes(normalize(way)) : way.test(text),
    );
  const show = (expected: Expected) =>
    (Array.isArray(expected) ? expected : [expected]).map(String).join("｜");
  const refused = reply.text.includes(REFUSAL);

  if (entry.tests === "refusal") {
    if (!refused) failures.push("not refused");
    if (reply.citations.length) failures.push("cites on a refusal");
    return failures;
  }
  if (refused) failures.push("refused");
  if (reply.text.trim() === CLARIFY) failures.push("asked back");
  for (const expected of entry.contains ?? [])
    if (!has(expected)) failures.push(`missing: ${show(expected)}`);
  for (const expected of entry.mustNotContain ?? [])
    if (has(expected)) failures.push(`must not contain: ${show(expected)}`);
  if (!reply.citations.length) failures.push("no citation");
  else if (
    entry.cites &&
    !reply.citations.some((c) =>
      entry.cites!.some(
        (where) => c.label.includes(where) || c.source?.label?.includes(where),
      ),
    )
  )
    failures.push(`cites none of: ${entry.cites.join("｜")}`);
  if (entry.tests === "pending") {
    if (!reply.text.includes(PENDING)) failures.push("not said to be 待確認");
    if (!reply.citations.some((c) => c.proposal || c.label.startsWith(PENDING)))
      failures.push("no 待確認 citation");
  }
  if (
    entry.viaGraph &&
    !retrieved.some((r) => r.lanes.graph && r.content.includes(entry.viaGraph!))
  )
    failures.push(`graph lane found no fact with ${entry.viaGraph}`);
  return failures;
}

/**
 * An answer as it is compared: NFKC, no whitespace or thousands
 * separators, dates as YYYY-MM-DD, `*` as ×, dashes as -, lower case.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(
      /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
      (_, y: string, m: string, d: string) =>
        `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
    )
    .replace(/[*✕✖]/g, "×")
    .replace(/[−–—]/g, "-")
    .toLowerCase();
}

/** PROVISIONAL: to be replaced by the team's 10 real questions (#40). */
export const TEAM_FAQ: FaqEntry[] = [
  {
    id: "F1",
    question: "避免排放算法現在怎麼算？",
    tests: "current",
    contains: ["A = W × EF × R × L"],
    note: "Current formula after the 2026-05-14 meeting's 取代 (seed 02, 03); the 待確認 − T may be mentioned besides.",
  },
  {
    id: "F2",
    question: "為什麼決定在避免排放公式裡加入壽命比 L？",
    tests: "reason",
    contains: [["剩餘壽命", "壽命比新品短", "壽命較短", "不如新品"], "高估"],
    cites: ["02-meeting-2026-05-14.txt"],
    note: "The reason is only in the meeting transcript (seed 02).",
  },
  {
    id: "F3",
    question: "三月時我們的避免排放公式是什麼？",
    tests: "as-of",
    // v1 then, and that it became × L later (#32): the 示範資料 seeds v1's
    // 取代 by the May meeting, which the 輸入 subgraph now proposes.
    contains: [/a=w×ef×r(?!×l)/, "×L"],
    note: "As of March: v1 (seed 01, dated by its 最後更新 2026-03-02); the answer goes on to say it became × L in May.",
  },
  {
    id: "F4",
    question: "減碳計算模型是誰負責的？",
    tests: "alias",
    contains: ["林小樹"],
    note: "「減碳計算模型」 is seed 01's other name for 避免排放算法, whose owner is 林小樹.",
  },
  {
    id: "F5",
    question: "林小樹負責的那個算法，取代率 R 是多少？",
    tests: "graph hop",
    contains: ["0.7"],
    viaGraph: "0.7",
    note: "林小樹 → 負責 → 避免排放算法 → 取代率 R: named only through a person.",
  },
  {
    id: "F6",
    question: "我們每個月還要寄減碳報表 CSV 給霧橋市循環經濟辦公室嗎？",
    tests: "obsolete",
    contains: [["不用", "不再", "停止", "不需要", "已停"]],
    note: "Seed 01's monthly report was marked 過時 as of 2026-07 (seed 02).",
  },
  {
    id: "F7",
    question: "取件的運送排放現在有扣除嗎？",
    tests: "pending",
    contains: [
      ["沒有扣除", "未扣除", "沒有扣", "尚未決定", "還沒決定", "不扣除"],
    ],
    note: "Confirmed: not deducted, still undecided (seed 01, 02). 待確認: deduct T = km × 0.12 (upload/meeting-2026-11-12.txt, left pending); the answer must say both.",
  },
  {
    id: "F8",
    question: "PR #212 改了什麼？",
    tests: "keyword",
    contains: [["壽命比", "lifetimeRatio"]],
    note: "A code the question names verbatim (seed 03's repo weekly).",
  },
  {
    id: "F9",
    question: "在 megaweaving.net 交換物品要付錢嗎？",
    tests: "faq",
    contains: [["免費", "不用"], "Lalamove", "ECPay"],
    cites: ["faq.txt", "07-megaweaving-net-platform.md"],
    note: "The kb-chatbot answer key's Q1, from the FAQ txt and the platform md.",
  },
  {
    id: "F10",
    question: "團隊的年度預算是多少？",
    tests: "refusal",
    note: "No source says anything about a budget.",
  },
];
