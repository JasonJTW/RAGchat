import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_USERNAME, logIn, upload } from "./admin-login";
import { ask, askFollowUp } from "./ask";

// The spec's Demo Script 1–8, run in order against one server that starts with
// an empty document store, checking every answer-key entry against the real
// model (.scratch/kb-chatbot/fixtures/answer-key.md). Tests run in file order
// and share the server's state: step 3's uploads feed steps 5–8.

const EVIDENCE = path.join(__dirname, "../../.scratch/kb-chatbot/evidence/10");

/** The server reads a key from the shell, else the root .env (shell wins). */
function hasKey(name: string): boolean {
  if (name in process.env) return !!process.env[name];
  const env = path.join(__dirname, "../../.env");
  return (
    existsSync(env) &&
    new RegExp(`^${name}=\\S`, "m").test(readFileSync(env, "utf8"))
  );
}

// `contains` lists facts; a fact written several ways is an array, and any one
// way matches. `cites` lists locations as "file › heading › …"; a citation
// matches when its label starts with the file and includes every heading.
interface Entry {
  id: string;
  question: string;
  contains: (string | string[])[];
  cites: string[];
}

const KEY: Record<string, Entry> = Object.fromEntries(
  (
    [
      {
        id: "Q1",
        question: "在 megaweaving.net 交換物品要付錢嗎？",
        contains: ["免費", "Lalamove", "ECPay"],
        cites: [
          "faq.txt",
          "07-megaweaving-net-platform.md › 核心流程（README）",
        ],
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
        id: "Q3",
        question: "那它是哪幾年辦的？總共做了幾個案例？",
        contains: ["2008", "2012", ["20 多個", "二十多個"]],
        cites: [
          "05-projects-and-practice.md › A. 教學 › A1. 一百元的大直社區改造計畫",
          "03-timeline.md › 理念實踐期（2008–2014）",
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
        id: "Q10",
        question: "我想去拿別人分享的東西，取件前要先確認什麼？",
        contains: ["物品狀況", "取件方式", "仍可索取"],
        cites: [
          "pickup-notice.txt",
          "06-facebook-community.md › 使用規範（平台／文章所述）",
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
    ] satisfies Entry[]
  ).map((entry) => [entry.id, entry]),
);

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

const REFUSAL = "這個問題我無法回答";
const CLARIFY = "請問你指的是哪個計畫或主題？";
const SUPPORT = "support@megaweaving.example";

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

function note(type: string, description: string) {
  test.info().annotations.push({ type, description });
}

/** One row per document: the rows that have a 刪除 button. */
async function documentRows(page: Page) {
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  return page
    .getByRole("table")
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "刪除" }) });
}

type Answer = Awaited<ReturnType<typeof ask>>;

/** Checks the answer streamed, its first character within 5 s. */
function expectStreamed(id: string, { firstCharMs, distinctLengths }: Answer) {
  note(`${id} first character`, `${firstCharMs} ms`);
  expect(firstCharMs).toBeLessThan(5_000);
  expect(distinctLengths).toBeGreaterThan(5);
}

/** `contains` + `cites`, plus the 5 s first character. */
async function expectMatches(entry: Entry, reply: Answer) {
  const { answer, text } = reply;
  note(`${entry.id} answer`, text);
  // Ticket 13: every first question goes through Jev; none here is asked back.
  expect(text).not.toBe(CLARIFY);
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
  note(`${entry.id} citations`, labels.join("\n"));
  await answer.screenshot({ path: path.join(EVIDENCE, `${entry.id}.png`) });
  expect(
    labels.some((label) =>
      entry.cites.some((location) =>
        citesMatch(label.replace(/^\[\d+\] /, ""), location),
      ),
    ),
    `a citation points to ${entry.cites.join("｜")}:\n${labels.join("\n")}`,
  ).toBe(true);
  expectStreamed(entry.id, reply);
}

function citesMatch(label: string, location: string): boolean {
  const [file, ...headings] = location.split(" › ");
  return label.startsWith(file) && headings.every((h) => label.includes(h));
}

/** `refuses`: the refusal and the support address, no citations. */
async function expectRefuses(id: string, reply: Answer) {
  const { answer, text } = reply;
  note(`${id} answer`, text);
  await answer.screenshot({ path: path.join(EVIDENCE, `${id}.png`) });
  expect(text).not.toBe(CLARIFY);
  expect(text).toContain(REFUSAL);
  expect(text).toContain(SUPPORT);
  await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
  note(`${id} citations`, "none");
  // A refusal may arrive in one piece (the threshold skips the model), so
  // only the first character's time is checked, not the streaming.
  note(`${id} first character`, `${reply.firstCharMs} ms`);
  expect(reply.firstCharMs).toBeLessThan(5_000);
}

/** Asks an answer-key question in a new conversation and checks it. */
function answerKeyTest(id: string) {
  const entry = KEY[id];
  test(`5. ${id}: ${entry.question}`, async ({ page }) => {
    test.setTimeout(180_000);
    await expectMatches(entry, await ask(page, entry.question));
  });
}

test.describe("demo script @live", () => {
  test.skip(!hasKey("AI_GATEWAY_API_KEY"), "AI_GATEWAY_API_KEY is not set");

  test("1. /admin without logging in leads to the login screen", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, "step1.png") });
  });

  test("2. a wrong password is refused; the right one opens an empty list", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.getByRole("textbox", { name: "帳號" }).fill(ADMIN_USERNAME);
    await page.getByLabel("密碼").fill("wrong-password");
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "帳號或密碼錯誤",
    );
    await page.screenshot({ path: path.join(EVIDENCE, "step2-wrong.png") });

    await logIn(page);
    await expect(await documentRows(page)).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE, "step2-empty.png") });
  });

  test("3. U1: two batches list 13 documents, each with chunks", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await logIn(page);
    await upload(page, ...MARKDOWN);
    await upload(page, ...OTHERS);

    const rows = await documentRows(page);
    await expect(rows).toHaveCount(13);
    for (const name of [...MARKDOWN, ...OTHERS]) {
      const chunks = await rows
        .filter({ hasText: name })
        .getByRole("cell")
        .nth(2)
        .textContent();
      note(name, `${chunks} chunks`);
      expect(Number.parseInt(chunks ?? "", 10)).toBeGreaterThanOrEqual(1);
    }
    await page.screenshot({
      path: path.join(EVIDENCE, "U1.png"),
      fullPage: true,
    });
  });

  test("4. U2: a .docx is refused and the list stays at 13", async ({
    page,
  }) => {
    await logIn(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "選擇檔案" }).click();
    await (
      await chooser
    ).setFiles(
      path.join(
        __dirname,
        "../../.scratch/kb-chatbot/fixtures/upload/not-supported.docx",
      ),
    );
    await page.getByRole("button", { name: "上傳" }).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "不支援的檔案格式",
    );
    await expect(await documentRows(page)).toHaveCount(13);
    await page.screenshot({
      path: path.join(EVIDENCE, "U2.png"),
      fullPage: true,
    });
  });

  answerKeyTest("Q1");

  test("5. Q2, then Q3 follows it up in the same conversation", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await expectMatches(KEY.Q2, await ask(page, KEY.Q2.question));
    await expectMatches(KEY.Q3, await askFollowUp(page, KEY.Q3.question));
  });

  test("5–6. Q4, and C1: its citation expands to the 移動微型空間計畫 table", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const reply = await ask(page, KEY.Q4.question);
    await expectMatches(KEY.Q4, reply);

    const citation = reply.answer
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
    note("C1 passage", passage);
    await reply.answer.screenshot({ path: path.join(EVIDENCE, "C1.png") });
    for (const fact of ["旅梯計畫", "2017–2023", "5 站", "站數（截至 2023）"])
      expect(passage).toContain(normalize(fact));
  });

  for (const id of ["Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11"])
    answerKeyTest(id);

  test("7. Q12: a question the documents don't cover is refused", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await expectRefuses(
      "Q12",
      await ask(page, "我的帳號被停權了，要怎麼申訴？"),
    );
  });

  test("8. U3 and Q6-after-delete: deleting Q6's sources makes it refused", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page);
    const rows = await documentRows(page);
    for (const name of ["faq.txt", "07-megaweaving-net-platform.md"]) {
      // A retry finds the documents already deleted by the first attempt.
      if (!(await rows.filter({ hasText: name }).count())) continue;
      await rows
        .filter({ hasText: name })
        .getByRole("button", { name: "刪除" })
        .click();
      await expect(rows.filter({ hasText: name })).toHaveCount(0);
    }
    await expect(rows).toHaveCount(11);
    await page.screenshot({
      path: path.join(EVIDENCE, "U3.png"),
      fullPage: true,
    });

    await page.goto("/");
    await page.getByRole("button", { name: "新對話" }).click();
    await expectRefuses(
      "Q6-after-delete",
      await askFollowUp(page, KEY.Q6.question),
    );
  });

  // Not Demo Script steps: tickets 06b, 12 and 13, run on the same documents.
  test.describe("a first question's subject check", () => {
    test.skip(!hasKey("JEV_API_KEY"), "JEV_API_KEY is not set");
    const EVIDENCE_12 = path.join(EVIDENCE, "../12");
    const EVIDENCE_13 = path.join(EVIDENCE, "../13");

    test("one without a subject or pronoun, after 新對話, asks which subject is meant", async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await ask(page, KEY.Q2.question);
      await page.getByRole("button", { name: "新對話" }).click();

      const { answer, text } = await askFollowUp(page, "是哪幾年辦的？");
      note("answer", text);
      await answer.screenshot({ path: path.join(EVIDENCE_13, "1.png") });

      expect(text).toBe(CLARIFY);
      await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
    });

    test("Q3 after 新對話 asks which subject is meant", async ({ page }) => {
      test.setTimeout(300_000);
      await ask(page, KEY.Q2.question);
      await page.getByRole("button", { name: "新對話" }).click();

      const { answer, text } = await askFollowUp(page, KEY.Q3.question);
      note("answer", text);
      await answer.screenshot({ path: path.join(EVIDENCE, "06b.png") });
      await answer.screenshot({ path: path.join(EVIDENCE_12, "1.png") });

      expect(text).toBe(CLARIFY);
      expect(text).not.toMatch(/2008|2012/);
      await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
    });

    test("one that names its subject is answered, with citations", async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const reply = await ask(page, "那個旅梯計畫的起點在哪裡？");
      note("answer", reply.text);
      await reply.answer.screenshot({ path: path.join(EVIDENCE_12, "2.png") });

      expect(reply.text).toContain("台新");
      const labels = await reply.answer
        .getByRole("list", { name: "出處" })
        .getByRole("listitem")
        .locator("summary")
        .allTextContents();
      note("citations", labels.join("\n"));
      // Both documents state where the project started; either one is a
      // correct citation.
      const sources = [
        "05-projects-and-practice.md › C. 移動微型空間計畫",
        "03-timeline.md › 社群期",
      ];
      expect(
        labels.some((label) =>
          sources.some((source) =>
            citesMatch(label.replace(/^\[\d+\] /, ""), source),
          ),
        ),
        `a citation points to ${sources.join("｜")}:\n${labels.join("\n")}`,
      ).toBe(true);
      expectStreamed("那個旅梯計畫", reply);
    });
  });
});
