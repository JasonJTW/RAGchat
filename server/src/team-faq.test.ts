import { describe, expect, it } from "vitest";
import { type FaqEntry, grade, TEAM_FAQ } from "./team-faq.js";

const fact = (label = "知識庫 · 2026-05-18") => ({ label });

describe("grading an answer to a team FAQ question", () => {
  const formula: FaqEntry = {
    id: "F1",
    question: "避免排放算法現在怎麼算？",
    tests: "current",
    contains: ["A = W × EF × R × L"],
  };

  it("passes an answer with every expected fact and a citation", () => {
    expect(
      grade(formula, {
        text: "目前公式是 A = W × EF × R × L [1]。",
        citations: [fact()],
      }),
    ).toEqual([]);
  });

  it("matches facts however spaces, multiplication signs and case are written", () => {
    expect(
      grade(formula, { text: "a=w*ef*r*l [1]", citations: [fact()] }),
    ).toEqual([]);
  });

  it("fails an answer missing an expected fact, naming it", () => {
    expect(
      grade(formula, {
        text: "公式是 A = W × EF × R [1]",
        citations: [fact()],
      }),
    ).toEqual(["missing: A = W × EF × R × L"]);
  });

  it("accepts any one way of writing a fact", () => {
    const entry: FaqEntry = {
      ...formula,
      contains: [["一百元", "100 元"]],
    };
    expect(
      grade(entry, { text: "上限 100元 [1]", citations: [fact()] }),
    ).toEqual([]);
  });

  it("matches a fact written as a pattern, e.g. the old formula without L", () => {
    const entry: FaqEntry = {
      ...formula,
      tests: "as-of",
      contains: [/a=w×ef×r(?!×l)/],
    };
    expect(
      grade(entry, {
        text: "三月時是 A = W × EF × R [1]，2026-05-18 起改為 A = W × EF × R × L。",
        citations: [fact()],
      }),
    ).toEqual([]);
    expect(
      grade(entry, { text: "A = W × EF × R × L [1]", citations: [fact()] }),
    ).toEqual(["missing: /a=w×ef×r(?!×l)/"]);
  });

  it("fails an answer with something it must not say", () => {
    const entry: FaqEntry = { ...formula, mustNotContain: ["每月 5 日前寄"] };
    expect(
      grade(entry, {
        text: "A=W×EF×R×L [1]；每月5日前寄報表。",
        citations: [fact()],
      }),
    ).toEqual(["must not contain: 每月 5 日前寄"]);
  });

  it("fails an answer that cites nothing, refuses or asks back", () => {
    expect(
      grade(formula, { text: "A = W × EF × R × L", citations: [] }),
    ).toEqual(["no citation"]);
    expect(
      grade(formula, {
        text: "知識庫裡沒有這件事的資料。如果你知道，可以直接告訴我。",
        citations: [],
      }),
    ).toEqual(["refused", "missing: A = W × EF × R × L", "no citation"]);
    expect(
      grade(formula, { text: "請問你指的是哪個計畫或主題？", citations: [] }),
    ).toEqual(["asked back", "missing: A = W × EF × R × L", "no citation"]);
  });

  it("needs a citation of a listed file, by its label or its passage's", () => {
    const entry: FaqEntry = {
      ...formula,
      cites: ["02-meeting-2026-05-14.txt"],
    };
    const text = "A = W × EF × R × L [1]";
    expect(
      grade(entry, {
        text,
        citations: [
          {
            label: "知識庫 · 2026-05-18",
            source: { label: "02-meeting-2026-05-14.txt › 開頭" },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      grade(entry, {
        text,
        citations: [{ label: "02-meeting-2026-05-14.txt › 開頭" }],
      }),
    ).toEqual([]);
    expect(grade(entry, { text, citations: [fact()] })).toEqual([
      "cites none of: 02-meeting-2026-05-14.txt",
    ]);
  });

  describe("a refusal question", () => {
    const refusal: FaqEntry = {
      id: "F10",
      question: "團隊的年度預算是多少？",
      tests: "refusal",
    };

    it("passes the refusal with no citation", () => {
      expect(
        grade(refusal, {
          text: "知識庫裡沒有這件事的資料。如果你知道，可以直接告訴我，我會整理成提案請團隊確認。",
          citations: [],
        }),
      ).toEqual([]);
    });

    it("fails an answer, or a refusal that cites", () => {
      expect(
        grade(refusal, { text: "預算是 10 萬 [1]", citations: [fact()] }),
      ).toEqual(["not refused", "cites on a refusal"]);
    });
  });

  describe("a question a 待確認 fact answers", () => {
    const pending: FaqEntry = {
      id: "F7",
      question: "取件的運送排放現在有扣除嗎？",
      tests: "pending",
      contains: ["0.12"],
    };

    it("needs the answer to say it is 待確認 and cite the 待確認 fact", () => {
      expect(
        grade(pending, {
          text: "知識庫：尚未決定 [1]。待確認的提案：扣除 T，每 km 0.12 [2]。",
          citations: [fact(), fact("待確認 · 2026-11-14")],
        }),
      ).toEqual([]);
      expect(
        grade(pending, {
          text: "扣除 T，每 km 0.12 [1]。",
          citations: [fact()],
        }),
      ).toEqual(["not said to be 待確認", "no 待確認 citation"]);
    });
  });

  describe("a question answered by walking the entity graph", () => {
    const hop: FaqEntry = {
      id: "F5",
      question: "林小樹負責的那個算法，取代率 R 是多少？",
      tests: "graph hop",
      contains: ["0.7"],
      viaGraph: "0.7",
    };
    const reply = { text: "R 是 0.7 [1]", citations: [fact()] };

    it("needs the graph lane to have found a fact with the given text", () => {
      expect(
        grade(hop, reply, [
          { content: "取代率 R 所有類別統一為 0.7", lanes: { graph: 2 } },
        ]),
      ).toEqual([]);
      expect(
        grade(hop, reply, [
          { content: "取代率 R 所有類別統一為 0.7", lanes: { vector: 1 } },
        ]),
      ).toEqual(["graph lane found no fact with 0.7"]);
    });
  });
});

describe("the provisional team FAQ", () => {
  it("has 10 questions, each with its own id", () => {
    expect(TEAM_FAQ).toHaveLength(10);
    expect(new Set(TEAM_FAQ.map((e) => e.id)).size).toBe(10);
  });

  it("covers each kind of grading rule", () => {
    const kinds = new Set(TEAM_FAQ.map((e) => e.tests));
    for (const kind of [
      "current",
      "as-of",
      "alias",
      "graph hop",
      "pending",
      "refusal",
    ] as const)
      expect(kinds).toContain(kind);
  });
});
