import { expect, test } from "@playwright/test";
import { ADMIN_USERNAME, logIn } from "./admin-login";

test("opening /admin without logging in leads to the login screen", async ({
  page,
}) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
});

test("a wrong password shows an error and stays on the login screen", async ({
  page,
}) => {
  await page.goto("/admin/login");

  await page.getByRole("textbox", { name: "帳號" }).fill(ADMIN_USERNAME);
  await page.getByLabel("密碼").fill("wrong-password");
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "帳號或密碼錯誤",
  );
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("the right password opens the document list", async ({ page }) => {
  await logIn(page);

  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("columnheader", { name: "檔名" })).toBeVisible();
});

test("the admin API refuses calls without a session; chat does not", async ({
  request,
}) => {
  const upload = await request.post("/api/documents", {
    multipart: {
      files: {
        name: "faq.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Q: ?"),
      },
    },
  });
  expect(upload.status()).toBe(401);
  expect((await request.get("/api/documents")).status()).toBe(401);

  const chat = await request.post("/api/chat", { data: { messages: [] } });
  expect(chat.status()).toBe(200);
});
