import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openDocuments } from "./documents";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

/** Uploads a file from fixtures/upload/ (or an absolute path); returns its row. */
async function upload(page: Page, file: string) {
  await openDocuments(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(path.resolve(UPLOADS, file));
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible();
  return page
    .getByRole("row", { name: new RegExp(path.basename(file)) })
    .last();
}

async function viewChunks(page: Page, file: string) {
  const row = await upload(page, file);
  await row.getByRole("button", { name: "查看段落" }).click();
  return page
    .getByRole("list", { name: `${path.basename(file)} 的段落` })
    .getByRole("listitem");
}

test("an uploaded markdown file lists its real chunk count", async ({
  page,
}) => {
  const row = await upload(page, "05-projects-and-practice.md");

  // 02's report: 05-projects-and-practice.md splits into 13 chunks.
  await expect(
    row.getByRole("cell", { name: "13", exact: true }),
  ).toBeVisible();
});

test("查看段落 lists each chunk's heading path and first 80 characters", async ({
  page,
}) => {
  const row = await upload(page, "05-projects-and-practice.md");
  await row.getByRole("button", { name: "查看段落" }).click();

  const chunks = page.getByRole("list", {
    name: "05-projects-and-practice.md 的段落",
  });
  await expect(chunks.getByRole("listitem")).toHaveCount(13);
  const c = chunks.getByRole("listitem").filter({
    hasText:
      "05-projects-and-practice.md › 05 實踐案例 Projects & Practice › C. 移動微型空間計畫",
  });
  await expect(c).toHaveCount(1);
  await expect(c).toContainText("| 計畫 | 期間 | 站數（截至 2023） |");
});

test("every chunk of a split table starts with the table header", async ({
  page,
}) => {
  const row = await upload(page, "03-timeline.md");
  await row.getByRole("button", { name: "查看段落" }).click();

  const period = page
    .getByRole("list", { name: "03-timeline.md 的段落" })
    .getByRole("listitem")
    .filter({ hasText: "› 理念實踐期（2008–2014）" });
  await expect(period).toHaveCount(3);
  for (const chunk of await period.all())
    await expect(chunk.getByRole("paragraph")).toHaveText(
      /^\| 時間 \| 事件 \| 來源 \|\n\|---\|---\|---\|/,
    );
});

test("faq.txt splits into one chunk per Q/A, messy ones included", async ({
  page,
}) => {
  const chunks = await viewChunks(page, "faq.txt");

  await expect(chunks).toHaveCount(6);
  for (const chunk of await chunks.all()) {
    await expect(chunk.getByRole("heading")).toHaveText(/^faq\.txt › Q[:：]/);
    await expect(chunk.getByRole("paragraph")).toHaveText(/^Q[:：].*\nA[:：]/);
  }
  // Q4 and Q5 have no blank line between them; Q6 uses 「Q：」.
  await expect(
    chunks.filter({ hasText: "faq.txt › Q: 搜尋一定要用中文關鍵字嗎？" }),
  ).not.toContainText("FB 社團原文");
  await expect(
    chunks.filter({
      hasText: "faq.txt › Q：「地球公物 / Commons」可以用了嗎？",
    }),
  ).toHaveCount(1);
});

test("a long txt paragraph splits by sentence, overlapping one", async ({
  page,
}) => {
  // Eight 50-character sentences, no blank line: sentences 1–6 fill the
  // first ~300-character chunk; the second repeats sentence 6.
  const chunks = await viewChunks(
    page,
    path.join(__dirname, "fixtures/long-paragraph.txt"),
  );

  await expect(chunks).toHaveCount(2);
  await expect(chunks.nth(0).getByRole("heading")).toHaveText(
    /^long-paragraph\.txt › 第一句說明/,
  );
  await expect(chunks.nth(1).getByRole("heading")).toHaveText(
    /^long-paragraph\.txt › 第六句說明/,
  );
});

test("a short txt paragraph is one chunk, cited by its opening", async ({
  page,
}) => {
  const chunks = await viewChunks(page, "pickup-notice.txt");

  await expect(chunks).toHaveCount(1);
  await expect(chunks.getByRole("heading")).toHaveText(
    "pickup-notice.txt › 取件與交接須知",
  );
});

test("a PDF splits by page, each chunk cited by its page number", async ({
  page,
}) => {
  const chunks = await viewChunks(page, "04-founder-hsiao-yu-chih.pdf");

  for (const n of [1, 2, 3, 4])
    await expect(
      chunks.filter({ hasText: `04-founder-hsiao-yu-chih.pdf › 第 ${n} 頁` }),
    ).not.toHaveCount(0);
  // The page's text layer, its Kangxi-radical glyphs (⽂) read as plain 文.
  await expect(
    chunks
      .filter({ hasText: "04-founder-hsiao-yu-chih.pdf › 第 4 頁" })
      .first()
      .getByRole("paragraph"),
  ).toContainText("2017 旅梯計畫 台新藝術獎文件展");
});

test("a page over the token limit splits evenly, leaving no scrap", async ({
  page,
}) => {
  const chunks = await viewChunks(page, "04-founder-hsiao-yu-chih.pdf");

  // Page 2 is ~820 tokens: two halves, not 796 tokens plus a 28-token tail.
  const page2 = chunks.filter({
    hasText: "04-founder-hsiao-yu-chih.pdf › 第 2 頁",
  });
  await expect(page2).toHaveCount(2);
  for (const chunk of await page2.all())
    expect(
      Array.from((await chunk.getByRole("paragraph").textContent()) ?? ""),
    ).toHaveLength(80);
});

test("a PDF without a text layer lists 0 chunks and 無法抽出文字", async ({
  page,
}) => {
  const row = await upload(
    page,
    path.join(__dirname, "fixtures/image-only.pdf"),
  );

  await expect(
    row.getByRole("cell", { name: /^0\s*無法抽出文字$/ }),
  ).toBeVisible();
});
