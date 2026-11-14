import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

test("home page renders", async ({ page }) => {
  await signIn(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
