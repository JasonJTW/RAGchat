import { expect, test } from "@playwright/test";

test("asking a question streams an answer with a citation", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "問題" }).fill("交換物品要付錢嗎？");
  await page.getByRole("button", { name: "送出" }).click();

  const answer = page.getByRole("article", { name: "回答" }).last();
  await expect(answer).toContainText("這是骨架的假回答", { timeout: 5000 });
  await expect(answer.getByRole("listitem")).toHaveCount(1);
});
