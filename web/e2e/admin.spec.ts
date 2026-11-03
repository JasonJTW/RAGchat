import path from "node:path";
import { expect, test } from "@playwright/test";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

test("uploading a document adds it to the list", async ({ page }) => {
  await page.goto("/admin");

  await page
    .getByLabel("選擇檔案")
    .setInputFiles(path.join(UPLOADS, "01-overview.md"));
  await page.getByRole("button", { name: "上傳" }).click();

  const row = page.getByRole("row", { name: /01-overview\.md/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible();
});
