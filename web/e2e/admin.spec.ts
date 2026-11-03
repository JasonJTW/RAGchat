import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { logIn } from "./admin-login";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

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
  await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible();
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
