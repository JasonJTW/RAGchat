import { expect, test } from "@playwright/test";
import { askFollowUp, send } from "./ask";

const FACT =
  "我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const INPUT = `請把以下內容輸入到知識庫：${FACT}`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("an input is confirmed into the knowledge base, and the next answer cites it", async ({
  page,
}) => {
  const reply = await send(page, INPUT);

  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("listitem")).toContainText(FACT);
  await page.screenshot({ path: test.info().outputPath("proposal.png") });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
  await expect(card.getByRole("button", { name: "確認" })).toHaveCount(0);

  const { answer } = await askFollowUp(page, "避免排放怎麼算？");

  const citation = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem")
    .first();
  await expect(citation).toContainText(/^\[1\] 知識庫 · \d{4}-\d{2}-\d{2}/);
  const source = citation.getByRole("blockquote");
  await expect(source).toBeHidden();
  await citation.locator("summary").click();
  await expect(citation.getByText(FACT, { exact: true })).toBeVisible();
  await expect(source).toHaveText(INPUT);
  await page.screenshot({ path: test.info().outputPath("cited.png") });
});

test("a rejected input stays out of the knowledge base", async ({ page }) => {
  const rejected = "週會改到每週四下午";
  const reply = await send(page, `記下：${rejected}`);
  const card = reply.getByRole("region", { name: "提案" });

  await card.getByRole("button", { name: "拒絕" }).click();
  await expect(card).toContainText("已拒絕");

  const { answer } = await askFollowUp(page, "週會是哪天？");
  // Earlier tests' confirmed facts may be cited; the rejected one never is.
  await expect(answer).not.toContainText(rejected);
});

test("an item edited on the card is confirmed as edited, and answers cite the edited text", async ({
  page,
}) => {
  const extracted = "倉庫盤點改在每月第一個週六";
  const edited = "倉庫盤點改在每月最後一個週六";
  const reply = await send(page, `請把以下內容輸入到知識庫：${extracted}`);
  const card = reply.getByRole("region", { name: "提案" });

  await card.getByRole("button", { name: "編輯" }).click();
  const text = card.getByRole("textbox", { name: "事實內容" });
  await expect(text).toHaveValue(extracted);
  await text.fill(edited);
  await expect(card.getByText("已編輯")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("editing.png") });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
  await expect(card.getByRole("listitem")).toContainText(edited);

  const { answer } = await askFollowUp(page, "倉庫盤點是什麼時候？");

  const citation = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem")
    .filter({ hasText: edited });
  await citation.locator("summary").click();
  await expect(citation.getByText(edited, { exact: true })).toBeVisible();
  // Named, not by Clerk id (stub sign-in names a user by the id without user_).
  await expect(citation).toContainText("經 e2e_member 編輯");
  await expect(citation).not.toContainText("user_e2e_member");
  await expect(citation.getByText(extracted, { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("cited-edited.png") });
});
