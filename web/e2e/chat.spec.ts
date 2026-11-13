import { expect, test } from "@playwright/test";
import { ask } from "./ask";

test("新對話 clears the conversation", async ({ page }) => {
  await ask(page, "旅梯計畫總共巡迴了幾站？是哪幾年？");
  await expect(page.getByRole("article", { name: "回答" })).toHaveCount(1);

  await page.getByRole("button", { name: "新對話" }).click();

  await expect(page.getByRole("article", { name: "回答" })).toHaveCount(0);
  await expect(
    page.getByText("旅梯計畫總共巡迴了幾站？是哪幾年？"),
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("cleared.png") });
});
