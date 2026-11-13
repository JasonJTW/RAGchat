import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { signIn } from "./sign-in";

/** Signs in as a 成員 and opens the document list (/documents). */
export async function openDocuments(page: Page) {
  await signIn(page);
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "文件" })).toBeVisible();
}

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

/** Uploads files from fixtures/upload/ in one batch, on the open document list. */
export async function upload(page: Page, ...names: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(names.map((name) => path.join(UPLOADS, name)));
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible({
    timeout: 120_000,
  });
}

/** Deletes every uploaded document, on the open document list. */
export async function removeAllDocuments(page: Page) {
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const rows = page.getByRole("table").getByRole("row");
  while ((await rows.count()) > 1) {
    const n = await rows.count();
    await rows.nth(1).getByRole("button", { name: "刪除" }).click();
    await expect(rows).toHaveCount(n - 1);
  }
}
