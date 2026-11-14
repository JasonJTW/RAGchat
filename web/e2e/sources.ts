import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);
export const FIXTURES = path.join(__dirname, "fixtures");

/** A file for the file chooser: a path (relative to fixtures/upload/), or a name and its content. */
export type FileToAttach = string | { name: string; buffer: Buffer };

/**
 * Attaches the files to a chat message the way a member does (附加檔案,
 * then the file chooser), sends it with the text, and waits for the reply.
 * Returns the reply.
 */
export async function sendFiles(page: Page, files: FileToAttach[], text = "") {
  const replies = page.getByRole("article", { name: "回答" });
  const earlier = await replies.count();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "附加檔案" }).click();
  await (
    await chooser
  ).setFiles(
    files.map((file) =>
      typeof file === "string"
        ? {
            name: path.basename(file),
            mimeType: "application/octet-stream",
            buffer: readFileSync(path.resolve(UPLOADS, file)),
          }
        : { ...file, mimeType: "application/octet-stream" },
    ),
  );
  await expect(page.getByRole("list", { name: "附件" })).toBeVisible();
  if (text) await page.getByRole("textbox", { name: "問題" }).fill(text);
  await page.getByRole("button", { name: "送出" }).click();
  // The files are read before the request starts, while 送出 is still
  // enabled: wait for the reply to begin, then for it to end (real models
  // take minutes on a long file).
  await expect(replies).toHaveCount(earlier + 1, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "送出" })).toBeEnabled({
    timeout: 300_000,
  });
  return replies.nth(earlier);
}

/** Sends the files in a new conversation and confirms every proposal of the reply. */
export async function inputAndConfirm(page: Page, ...files: FileToAttach[]) {
  await page.goto("/");
  const reply = await sendFiles(page, files);
  const cards = reply.getByRole("region", { name: "提案" });
  await expect(cards).toHaveCount(files.length);
  for (const card of await cards.all()) {
    await card.getByRole("button", { name: "確認" }).click();
    await expect(card).toContainText("已確認");
  }
}
