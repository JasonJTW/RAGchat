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
