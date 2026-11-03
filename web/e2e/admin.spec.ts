import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { logIn, upload } from "./admin-login";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

const ALL_MARKDOWN = [
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

/** Picks files the way a user does: click 選擇檔案, then answer the file chooser. */
async function chooseFiles(page: Page, ...names: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(names.map((name) => path.join(UPLOADS, name)));
}

test.beforeEach(async ({ page }) => {
  await logIn(page);
});

test("the upload button appears only after choosing a file", async ({
  page,
}) => {
  await page.goto("/admin");

  await expect(page.getByRole("button", { name: "上傳" })).toHaveCount(0);

  await chooseFiles(page, "01-overview.md");

  await expect(page.getByRole("main")).toContainText("01-overview.md");
  await expect(page.getByRole("button", { name: "上傳" })).toBeVisible();
});

test("uploading a document adds it to the list", async ({ page }) => {
  await page.goto("/admin");

  await chooseFiles(page, "01-overview.md");
  await page.getByRole("button", { name: "上傳" }).click();

  const row = page.getByRole("row", { name: /01-overview\.md/ }).first();
  await expect(row).toBeVisible();
  // 02's report: 01-overview.md splits into 6 chunks.
  await expect(row.getByRole("cell", { name: "6", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上傳" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible();
});

test("choosing a file while the page is still loading still uploads", async ({
  page,
}) => {
  await page.goto("/admin", { waitUntil: "commit" });

  await chooseFiles(page, "02-origin-philosophy.md");
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(
    page.getByRole("row", { name: /02-origin-philosophy\.md/ }).first(),
  ).toBeVisible({ timeout: 3000 });
});

test("a failed upload shows an error", async ({ page }) => {
  await page.route("**/api/documents", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, body: "boom" })
      : route.fallback(),
  );
  await page.goto("/admin");

  await chooseFiles(page, "03-timeline.md");
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "上傳失敗，請再試一次",
  );
});

test("an unsupported format is refused and not listed", async ({ page }) => {
  await page.goto("/admin");
  const rows = page.getByRole("table").getByRole("row");
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const before = await rows.count();

  await chooseFiles(page, "not-supported.docx");
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "不支援的檔案格式",
  );
  await expect(rows).toHaveCount(before);
});

test("more than 10 files at once are refused and not listed", async ({
  page,
}) => {
  await page.goto("/admin");
  const rows = page.getByRole("table").getByRole("row");
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const before = await rows.count();

  await chooseFiles(page, ...ALL_MARKDOWN, "faq.txt");
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "一次最多上傳 10 份",
  );
  await expect(rows).toHaveCount(before);
});

test("a file over 5 MB is refused and not listed", async ({ page }) => {
  await page.goto("/admin");
  const rows = page.getByRole("table").getByRole("row");
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const before = await rows.count();

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (
    await chooser
  ).setFiles({
    name: "big.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(6 * 1024 * 1024, "a"),
  });
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "單一檔案最大 5 MB",
  );
  await expect(rows).toHaveCount(before);
});

test("two batches add 13 rows, each with name, type, chunks, and time", async ({
  page,
}) => {
  await page.goto("/admin");
  const rows = page.getByRole("table").getByRole("row");
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const before = await rows.count();

  await upload(page, ...ALL_MARKDOWN);
  await upload(
    page,
    "04-founder-hsiao-yu-chih.pdf",
    "faq.txt",
    "pickup-notice.txt",
  );

  await expect(rows).toHaveCount(before + 13);
  for (const [name, type, chunks] of [
    ["03-timeline.md", "Markdown", "9"],
    ["04-founder-hsiao-yu-chih.pdf", "PDF", "5"],
    ["faq.txt", "純文字", "6"],
  ]) {
    const row = rows.filter({ hasText: name }).last();
    await expect(row.getByRole("cell")).toHaveText([
      name,
      type,
      chunks,
      /^\d{4}\/\d{1,2}\/\d{1,2} /,
      /.*/,
    ]);
  }
});
