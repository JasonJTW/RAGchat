import { expect, test, type Page } from "@playwright/test";
import { askFollowUp, send } from "./ask";

// 時間檢索: a fact dated by its content, replaced, then asked about at a time
// before the change. The stub models (see server/src/stub-models.ts) read a
// sentence opening 「YYYY-MM-DD 起」 as holding from that date, and
// 「X 不是 A，是 B」 as replacing A with B.

const SUBJECT = "旅梯模型的公式 Z";
const OLD = `2026-03-02 起${SUBJECT} 為 A × B`;
const NEW = `2026-03-02 起${SUBJECT} 為 A × B × C`;

const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei",
}).format(new Date());

async function confirm(page: Page, text: string) {
  const card = (await send(page, text)).getByRole("region", { name: "提案" });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
}

test("a dated fact shows its date on the card, and a question about that time is answered from what held then", async ({
  page,
}) => {
  await page.goto("/");
  const reply = await send(page, `請把以下內容輸入到知識庫：${OLD}`);
  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("listitem")).toContainText(
    "生效日期：2026-03-02",
  );
  await page.screenshot({ path: test.info().outputPath("dated-card.png") });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
  await askFollowUp(page, `${SUBJECT} 是什麼？`);
  await confirm(page, `${SUBJECT} 不是 A × B，是 A × B × C`);

  const { answer } = await askFollowUp(
    page,
    `2026 年 3 月時${SUBJECT} 是什麼？`,
  );

  const citation = answer
    .getByRole("list", { name: "出處" })
    .locator(":scope > li")
    .first();
  await expect(citation).toContainText(
    `知識庫 · 2026-03-02 起，${today} 止${OLD}`,
  );
  await expect(citation).toContainText(`之後的變更：${today} 起改為「${NEW}」`);
  await page.screenshot({ path: test.info().outputPath("past-answer.png") });

  // Leave no current fact behind for later specs.
  await askFollowUp(page, `${SUBJECT} 是什麼？`);
  await confirm(page, `${SUBJECT}已經過時`);
});
