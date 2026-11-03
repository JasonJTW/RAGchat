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

  const row = page.getByRole("row", { name: /01-overview\.md/ }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible();
});

test("clicking upload while the page is still loading still uploads", async ({
  page,
}) => {
  await page.goto("/admin", { waitUntil: "commit" });

  await page
    .getByLabel("選擇檔案")
    .setInputFiles(path.join(UPLOADS, "02-origin-philosophy.md"));
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(
    page.getByRole("row", { name: /02-origin-philosophy\.md/ }).first(),
  ).toBeVisible({ timeout: 3000 });
});

test("clicking upload with no file selected says so", async ({ page }) => {
  await page.goto("/admin");

  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "請先選擇檔案",
  );
});

test("a failed upload shows an error", async ({ page }) => {
  await page.route("**/api/documents", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, body: "boom" })
      : route.fallback(),
  );
  await page.goto("/admin");

  await page
    .getByLabel("選擇檔案")
    .setInputFiles(path.join(UPLOADS, "03-timeline.md"));
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "上傳失敗，請再試一次",
  );
});
