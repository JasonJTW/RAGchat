import { expect, test, type Locator, type Page } from "@playwright/test";
import { askFollowUp, send } from "./ask";
import { openDocuments, removeAllDocuments } from "./documents";

// 對話中修正: ask → correct → confirm → ask again. The stub models (see
// server/src/stub-models.ts) read 「X 不是 A，是 B」 as replacing A with B in
// the cited fact, and 「X 已經過時」 as marking it 過時.

const SUBJECT = "旅梯模型的係數 Q";
const REPLACEMENT = `${SUBJECT} 代表取代率`;
const RECYCLING = `${SUBJECT} 代表回收率`;
const QUESTION = `${SUBJECT} 代表什麼？`;

const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei",
}).format(new Date());

test.beforeEach(async ({ page }) => {
  // Only the knowledge base answers: earlier tests' documents are removed.
  await openDocuments(page);
  await removeAllDocuments(page);
  await page.goto("/");
});

/** Records the fact through a confirmed input. */
async function known(page: Page, fact: string) {
  const reply = await send(page, `請把以下內容輸入到知識庫：${fact}`);
  const card = reply.getByRole("region", { name: "提案" });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
}

/** Sends the correction and confirms the proposal it gets; returns the card. */
async function correct(page: Page, correction: string): Promise<Locator> {
  const card = (await send(page, correction)).getByRole("region", {
    name: "提案",
  });
  await expect(card).toBeVisible();
  return card;
}

/** The cited fact of the answer, expanded. */
async function citedFact(answer: Locator) {
  const citation = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem")
    .filter({ hasText: "知識庫" })
    .first();
  await citation.locator("summary").click();
  return citation;
}

test("a correction to an answer replaces the cited fact; the next answer gives the new one with its history", async ({
  page,
}) => {
  await known(page, REPLACEMENT);
  await askFollowUp(page, QUESTION);

  const card = await correct(page, "Q 不是取代率，是回收率");

  await expect(card.getByRole("heading")).toContainText("取代");
  const item = card.getByRole("listitem");
  await expect(item.getByLabel("舊")).toHaveText(REPLACEMENT);
  await expect(item.getByLabel("新")).toHaveText(RECYCLING);
  await expect(item).toContainText("原因：Q 不是取代率，是回收率");
  await expect(item).toContainText(`生效日期：${today}`);
  await page.screenshot({ path: test.info().outputPath("correction.png") });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");

  const { answer } = await askFollowUp(page, QUESTION);

  const citation = await citedFact(answer);
  await expect(
    citation.getByText(RECYCLING, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    citation.getByRole("list", { name: "歷史" }).getByRole("listitem"),
  ).toContainText([REPLACEMENT, RECYCLING]);
  await page.screenshot({ path: test.info().outputPath("history.png") });

  // Undone by correcting again: 取代率 → 回收率 → 取代率.
  const undo = await correct(page, "Q 不是回收率，是取代率");
  await undo.getByRole("button", { name: "確認" }).click();
  await expect(undo).toContainText("已確認");
  const again = await citedFact((await askFollowUp(page, QUESTION)).answer);
  await expect(
    again.getByRole("list", { name: "歷史" }).getByRole("listitem"),
  ).toContainText([REPLACEMENT, RECYCLING, REPLACEMENT]);
  await page.screenshot({ path: test.info().outputPath("history-undone.png") });

  // Later specs share the team workspace: leave no current fact behind.
  const cleanup = await correct(page, `${SUBJECT} 已經過時`);
  await cleanup.getByRole("button", { name: "確認" }).click();
  await expect(cleanup).toContainText("已確認");
});

test("a fact marked 過時 is no longer given, and nothing replaces it", async ({
  page,
}) => {
  const fact = "旅梯模型的係數 P 代表壽命比";
  await known(page, fact);
  await askFollowUp(page, "旅梯模型的係數 P 代表什麼？");

  const card = await correct(page, "旅梯模型的係數 P 已經過時");

  await expect(card.getByRole("heading")).toContainText("過時");
  await expect(card.getByRole("listitem").getByLabel("過時")).toHaveText(fact);
  await expect(card.getByRole("listitem").getByLabel("新")).toHaveCount(0);
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");

  const { answer } = await askFollowUp(page, "旅梯模型的係數 P 代表什麼？");
  await expect(answer).not.toContainText(fact);
});
