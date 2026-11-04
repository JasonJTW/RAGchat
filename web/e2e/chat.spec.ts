import { expect, test } from "@playwright/test";
import { logIn, upload } from "./admin-login";
import { ask } from "./ask";

// The E2E server's fake chat model always streams this reply (see
// server/src/stub-models.ts), citing the best-matching passage.
const STUB_REPLY = "這是假模型的回答，依據第 1 段。[1]";

test("an answer streams in and cites the passage it marks", async ({
  page,
}) => {
  await logIn(page);
  await upload(page, "05-projects-and-practice.md");

  const { answer, text, distinctLengths } = await ask(
    page,
    "旅梯計畫總共巡迴了幾站？是哪幾年？",
  );

  expect(text).toBe(STUB_REPLY);
  expect(distinctLengths).toBeGreaterThan(5);
  const citations = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem");
  await expect(citations).toHaveCount(1);
  const citation = citations.first();
  await expect(citation).toContainText(/^\[1\] .+\.md › /);
  const passage = citation.getByRole("paragraph");
  await expect(passage).toBeHidden();
  await citation.getByText(/\.md › /).click();
  await expect(passage).toBeVisible();
  await expect(passage).not.toBeEmpty();
});

test("a deleted document leaves the list and is no longer cited", async ({
  page,
}) => {
  const Q4 = "旅梯計畫總共巡迴了幾站？是哪幾年？";
  const citesQ4Source = async () =>
    (
      await (
        await ask(page, Q4)
      ).answer
        .getByRole("list", { name: "出處" })
        .locator("summary")
        .allTextContents()
    ).some((label) => /^\[\d+\] 05-projects-and-practice\.md › /.test(label));
  // Start from a known store: earlier tests share this server.
  await logIn(page);
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const rows = page.getByRole("table").getByRole("row");
  while ((await rows.count()) > 1) {
    const n = await rows.count();
    await rows.nth(1).getByRole("button", { name: "刪除" }).click();
    await expect(rows).toHaveCount(n - 1);
  }
  await upload(page, "01-overview.md", "05-projects-and-practice.md");
  expect(await citesQ4Source()).toBe(true);

  await page.goto("/admin");
  await page
    .getByRole("row", { name: /05-projects-and-practice\.md/ })
    .getByRole("button", { name: "刪除" })
    .click();

  // The header row and 01-overview.md remain.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("01-overview.md");
  expect(await citesQ4Source()).toBe(false);
});

test("新對話 clears the conversation", async ({ page }) => {
  await logIn(page);
  await upload(page, "05-projects-and-practice.md");
  await ask(page, "旅梯計畫總共巡迴了幾站？是哪幾年？");
  await expect(page.getByRole("article", { name: "回答" })).toHaveCount(1);

  await page.getByRole("button", { name: "新對話" }).click();

  await expect(page.getByRole("article", { name: "回答" })).toHaveCount(0);
  await expect(
    page.getByText("旅梯計畫總共巡迴了幾站？是哪幾年？"),
  ).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("cleared.png") });
});
