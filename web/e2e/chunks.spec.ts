import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { logIn } from "./admin-login";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

async function upload(page: Page, name: string) {
  await logIn(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(path.join(UPLOADS, name));
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible();
  return page.getByRole("row", { name: new RegExp(name) }).last();
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
