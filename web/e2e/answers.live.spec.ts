import { expect, test, type Locator } from "@playwright/test";
import { logIn, upload } from "./admin-login";
import { ask, askFollowUp } from "./ask";

// Answer-key entries checked against the real model
// (.scratch/kb-chatbot/fixtures/answer-key.md). `contains` lists facts; a fact
// written several ways is an array, and any one way matches. `cites` lists
// locations as "file › heading › …"; a citation matches when its label starts
// with the file and includes every heading.
interface Entry {
  id: string;
  question: string;
  contains: (string | string[])[];
  cites: string[];
}

const Q3: Entry = {
  id: "Q3",
  question: "那它是哪幾年辦的？總共做了幾個案例？",
  contains: ["2008", "2012", ["20 多個", "二十多個"]],
  cites: [
    "05-projects-and-practice.md › A. 教學 › A1. 一百元的大直社區改造計畫",
    "03-timeline.md › 理念實踐期（2008–2014）",
  ],
};

const ANSWER_KEY: Entry[] = [
  {
    id: "Q1",
    question: "在 megaweaving.net 交換物品要付錢嗎？",
    contains: ["免費", "Lalamove", "ECPay"],
    cites: ["faq.txt", "07-megaweaving-net-platform.md › 核心流程（README）"],
  },
  {
    id: "Q2",
    question: "一百元的大直社區改造計畫，每個學生最多可以花多少錢？",
    contains: [["100 元", "一百元"], "廢料"],
    cites: [
      "05-projects-and-practice.md › A. 教學 › A1. 一百元的大直社區改造計畫",
    ],
  },
  {
    id: "Q4",
    question: "旅梯計畫總共巡迴了幾站？是哪幾年？",
    contains: ["5 站", "2017", "2023"],
    cites: ["05-projects-and-practice.md › C. 移動微型空間計畫"],
  },
  {
    id: "Q5",
    question: "megaweaving 平台的 GitHub repo 是哪一天建立的？",
    contains: ["2025-06-21"],
    cites: [
      "07-megaweaving-net-platform.md › 開發時間線（GitHub API，2026-11-03 查詢）",
      "03-timeline.md › 平台期（2025–）",
    ],
  },
  {
    id: "Q6",
    question: "搜尋一定要用中文關鍵字嗎？",
    contains: ["語意", ["跨語言", "英文"]],
    cites: [
      "faq.txt",
      "07-megaweaving-net-platform.md › 功能清單（README 所述）",
    ],
  },
  {
    id: "Q7",
    question: "蕭有志有沒有在日本的大學教過線上課？",
    contains: ["東京理科大學", "2021"],
    cites: ["04-founder-hsiao-yu-chih.pdf › 第 2 頁"],
  },
  {
    id: "Q8",
    question: "蕭有志個人網站上的作品分成哪幾類？各有幾件？",
    contains: ["方案 24", "實驗室系列 39", "展覽 10", "工作營 17"],
    cites: ["04-founder-hsiao-yu-chih.pdf › 第 4 頁"],
  },
  {
    id: "Q9",
    question: "大量交織的 FB 社團現在有多少成員？",
    contains: ["12000", "8000", ["11k", "11000", "1.1 萬"]],
    cites: [
      "06-facebook-community.md › 成員數變化",
      "10-discrepancies-open-questions.md › A. 來源之間的矛盾",
    ],
  },
  {
    id: "Q11",
    question: "「過剩成為養份」是蕭有志自己原創的概念嗎？",
    contains: [
      ["不是", "並非"],
      ["搖籃到搖籃", "Cradle to Cradle"],
    ],
    cites: ["02-origin-philosophy.md › 2.5 五個關鍵字"],
  },
  {
    id: "Q10",
    question: "我想去拿別人分享的東西，取件前要先確認什麼？",
    contains: ["物品狀況", "取件方式", "仍可索取"],
    cites: [
      "pickup-notice.txt",
      "06-facebook-community.md › 使用規範（平台／文章所述）",
    ],
  },
];

const MARKDOWN = [
  "README.md",
  "01-overview.md",
  "02-origin-philosophy.md",
  "03-timeline.md",
  "05-projects-and-practice.md",
  "06-facebook-community.md",
  "07-megaweaving-net-platform.md",
  "08-media-coverage.md",
  "09-sources.md",
  "10-discrepancies-open-questions.md",
];

const OTHERS = ["04-founder-hsiao-yu-chih.pdf", "faq.txt", "pickup-notice.txt"];

// The answer key's normalisation: no thousands separators, dates as
// YYYY-MM-DD, 五站 = 5 站; plus no whitespace and lowercase.
function normalize(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(
      /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
      (_, y: string, m: string, d: string) =>
        `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
    )
    .replace(/五站/g, "5站")
    .toLowerCase();
}

async function expectMatches(entry: Entry, answer: Locator, text: string) {
  test
    .info()
    .annotations.push({ type: `${entry.id} answer`, description: text });
  for (const fact of entry.contains) {
    const ways = Array.isArray(fact) ? fact : [fact];
    expect(
      ways.some((way) => normalize(text).includes(normalize(way))),
      `answer contains ${ways.join("｜")}:\n${text}`,
    ).toBe(true);
  }
  const labels = await answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem")
    .locator("summary")
    .allTextContents();
  test.info().annotations.push({
    type: `${entry.id} citations`,
    description: labels.join("\n"),
  });
  await answer.screenshot({
    path: test.info().outputPath(`${entry.id}-answer.png`),
  });
  expect(
    labels.some((label) =>
      entry.cites.some((location) =>
        citesMatch(label.replace(/^\[\d+\] /, ""), location),
      ),
    ),
    `a citation points to ${entry.cites.join("｜")}:\n${labels.join("\n")}`,
  ).toBe(true);
}

function citesMatch(label: string, location: string): boolean {
  const [file, ...headings] = location.split(" › ");
  return label.startsWith(file) && headings.every((h) => label.includes(h));
}

test.describe("answer key @live", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await logIn(page);
    // A retried worker re-runs this hook; don't upload twice.
    await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
    // The demo's two batches: the 10 markdown files, then the other 3.
    for (const batch of [MARKDOWN, OTHERS])
      if ((await page.getByRole("row", { name: batch[0] }).count()) === 0)
        await upload(page, ...batch);
    await page.close();
  });

  for (const entry of ANSWER_KEY)
    test(`${entry.id}: ${entry.question}`, async ({ page }) => {
      test.setTimeout(180_000);
      const { answer, text, firstCharMs, distinctLengths } = await ask(
        page,
        entry.question,
      );
      await expectMatches(entry, answer, text);
      // Streams: the first character within 5 s, then grows.
      test.info().annotations.push({
        type: "first character",
        description: `${firstCharMs} ms`,
      });
      expect(firstCharMs).toBeLessThan(5_000);
      expect(distinctLengths).toBeGreaterThan(5);
    });

  test("Q12: 我的帳號被停權了，要怎麼申訴？ is refused", async ({ page }) => {
    test.setTimeout(180_000);
    const { answer, text } = await ask(page, "我的帳號被停權了，要怎麼申訴？");
    test.info().annotations.push({ type: "answer", description: text });
    await answer.screenshot({ path: test.info().outputPath("answer.png") });

    expect(text).toContain("這個問題我無法回答");
    expect(text).toContain("support@megaweaving.example");
    await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
  });

  test("Q3 follows up Q2", async ({ page }) => {
    test.setTimeout(300_000);
    await ask(page, ANSWER_KEY.find((e) => e.id === "Q2")!.question);

    const followUp = await askFollowUp(page, Q3.question);
    await expectMatches(Q3, followUp.answer, followUp.text);
  });

  test("Q3 after 新對話 asks which subject is meant", async ({ page }) => {
    test.setTimeout(300_000);
    await ask(page, ANSWER_KEY.find((e) => e.id === "Q2")!.question);
    await page.getByRole("button", { name: "新對話" }).click();

    const { answer, text } = await askFollowUp(page, Q3.question);
    test.info().annotations.push({ type: "answer", description: text });
    await answer.screenshot({ path: test.info().outputPath("answer.png") });

    expect(text).toBe("請問你指的是哪個計畫或主題？");
    await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
    expect(text.includes("2008") && text.includes("2012")).toBe(false);
  });

  test("C1: Q4's citation expands to the 移動微型空間計畫 table", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { answer } = await ask(page, "旅梯計畫總共巡迴了幾站？是哪幾年？");

    const citation = answer
      .getByRole("list", { name: "出處" })
      .getByRole("listitem")
      .filter({
        hasText:
          /^\[\d+\] 05-projects-and-practice\.md › .*C\. 移動微型空間計畫/,
      })
      .first();
    await citation.locator("summary").click();
    const passage = normalize(
      (await citation.getByRole("paragraph").textContent()) ?? "",
    );
    test.info().annotations.push({ type: "passage", description: passage });
    await answer.screenshot({ path: test.info().outputPath("answer.png") });
    for (const fact of ["旅梯計畫", "2017–2023", "5 站", "站數（截至 2023）"])
      expect(passage).toContain(normalize(fact));
  });
});
