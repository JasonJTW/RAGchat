import { expect, test } from "@playwright/test";
import { signIn } from "./sign-in";

// Every other spec starts signed in as a 成員 (playwright.config.ts); these
// start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("a visitor who is not signed in is sent to sign in", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("textbox", { name: "問題" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("sign-in.png") });
});

test("a visitor who is not signed in reaches no knowledge base API", async ({
  page,
}) => {
  const chat = await page.request.post("/api/chat", { data: { messages: [] } });
  expect(chat.status()).toBe(401);
  expect((await page.request.post("/api/sources")).status()).toBe(401);
  expect(
    (
      await page.request.post(
        "/api/proposals/00000000-0000-0000-0000-000000000000/confirm",
      )
    ).status(),
  ).toBe(401);
});

test("a signed-in 訪客 is told guest trials are not open yet", async ({
  page,
}) => {
  await signIn(page, "guest");

  await page.goto("/");

  await expect(page.getByRole("main")).toContainText("訪客試用尚未開放");
  await expect(page.getByRole("textbox", { name: "問題" })).toHaveCount(0);
  const chat = await page.request.post("/api/chat", { data: { messages: [] } });
  expect(chat.status()).toBe(403);
  await page.screenshot({ path: test.info().outputPath("guest.png") });
});

test("a signed-in 成員 gets the chat", async ({ page }) => {
  await signIn(page);

  await page.goto("/");

  await expect(page.getByRole("textbox", { name: "問題" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("member.png") });
});

test("the old admin pages are gone", async ({ page }) => {
  await signIn(page);

  const admin = await page.goto("/admin");
  expect(admin?.status()).toBe(404);
  const login = await page.goto("/admin/login");
  expect(login?.status()).toBe(404);
});
