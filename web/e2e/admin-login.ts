import path from "node:path";
import { expect, type Page } from "@playwright/test";

// The E2E server is started with these credentials (see playwright.config.ts).
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "e2e-password";

/** Logs in the way the admin does: open /admin, fill the login form. */
export async function logIn(page: Page) {
  await page.goto("/admin");
  await page.getByRole("textbox", { name: "帳號" }).fill(ADMIN_USERNAME);
  await page.getByLabel("密碼").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

/** Uploads files from fixtures/upload/ in one batch, from the logged-in admin. */
export async function upload(page: Page, ...names: string[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(names.map((name) => path.join(UPLOADS, name)));
  await page.getByRole("button", { name: "上傳" }).click();
  await expect(page.getByRole("button", { name: "選擇檔案" })).toBeVisible({
    timeout: 120_000,
  });
}
