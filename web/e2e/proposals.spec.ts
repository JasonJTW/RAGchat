import { expect, test, type Locator, type Page } from "@playwright/test";
import { askFollowUp, send } from "./ask";
import { signIn } from "./sign-in";

// A 提案's life: any 成員 confirms it from the 待確認 list, confirming is
// re-checked against what changed since, and a newer proposal's card tells
// which older pending items it expires. The stub models read 「X 不是 A，是
// B」 as a 取代 and 「X 已經過時」 as a 過時 (server/src/stub-models.ts).

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** Sends the message; returns the 提案 card of its reply. */
async function proposed(page: Page, text: string): Promise<Locator> {
  const card = (await send(page, text)).getByRole("region", { name: "提案" });
  await expect(card).toBeVisible();
  return card;
}

async function confirmOn(card: Locator) {
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
}

/** Marks the subject's fact 過時, so later specs see no current fact of it. */
async function retire(page: Page, subject: string) {
  await page.goto("/");
  await askFollowUp(page, `${subject} 代表什麼？`);
  const card = await proposed(page, `${subject} 已經過時`);
  await confirmOn(card);
}

test("a 成員 confirms, from the 待確認 list, a proposal another member made", async ({
  page,
}) => {
  const fact = "銀河計畫的係數 J 代表質量";
  await signIn(page, "member", "user_e2e_other");
  await page.goto("/");
  await proposed(page, `請把以下內容輸入到知識庫：${fact}`);

  await signIn(page, "member", "user_e2e_member");
  await page.getByRole("link", { name: "待確認" }).click();
  const card = page
    .getByRole("region", { name: "提案" })
    .filter({ hasText: fact });
  await expect(card).toContainText("user_e2e_other 提出");
  await page.screenshot({ path: test.info().outputPath("pending-list.png") });
  await confirmOn(card);

  await page.goto("/");
  const { answer } = await askFollowUp(page, "銀河計畫的係數 J 代表什麼？");
  await expect(answer).toContainText(fact);
  await retire(page, "銀河計畫的係數 J");
});

test("confirming after the knowledge base changed shows the change, and goes through once confirmed anyway", async ({
  page,
}) => {
  const subject = "銀河計畫的係數 K";
  const taken = `${subject} 代表取代率`;
  const recycled = `${subject} 代表回收率`;
  await confirmOn(await proposed(page, `請把以下內容輸入到知識庫：${taken}`));
  await askFollowUp(page, `${subject} 代表什麼？`);
  const replace = await proposed(page, "K 不是取代率，是回收率");
  await askFollowUp(page, `${subject} 代表什麼？`);
  const obsolete = await proposed(page, `${subject} 已經過時`);
  // Confirming the newer 過時 would expire the older 取代 item.
  await expect(
    obsolete.getByRole("list", { name: "會過期的項目" }),
  ).toContainText(recycled);

  await confirmOn(replace);
  await obsolete.getByRole("button", { name: "確認" }).click();

  const warning = obsolete.getByRole("alert", { name: "知識庫已變更" });
  await expect(warning.getByLabel("變更前")).toHaveText(taken);
  await expect(warning.getByLabel("變更後")).toHaveText(recycled);
  await page.screenshot({ path: test.info().outputPath("conflict.png") });
  await obsolete.getByRole("button", { name: "仍確認" }).click();
  await expect(obsolete).toContainText("已確認");
  // The 過時 applied to the fact now in the old one's place.
  await expect(obsolete.getByLabel("過時")).toHaveText(recycled);
});

test("confirming a newer proposal of the same fact expires the older one", async ({
  page,
}) => {
  const fact = "銀河計畫的係數 N 代表排放係數";
  const input = `請把以下內容輸入到知識庫：${fact}`;
  await proposed(page, input);
  const newer = await proposed(page, input);
  await expect(newer).toContainText("確認後，以下較早的待確認項目會過期");
  await expect(newer.getByRole("list", { name: "會過期的項目" })).toContainText(
    fact,
  );

  await confirmOn(newer);

  await page.getByRole("link", { name: "待確認" }).click();
  await expect(page.getByText("讀取中…")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "提案" }).filter({ hasText: fact }),
  ).toHaveCount(0);
  await retire(page, "銀河計畫的係數 N");
});
