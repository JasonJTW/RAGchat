import { expect, test, type Page } from "@playwright/test";
import { askFollowUp, send } from "./ask";

// 實體連結: an input's card marks its new entities; a member relinks one to
// an existing entity, whose alias it becomes; a question by the alias then
// finds the facts recorded under the entity. The stub models (see
// server/src/stub-models.ts) name an entity per 「…」 and link nothing on
// their own, so every name the workspace hasn't used is a new entity.

const ALGORITHM = "旅梯排放算法";
const MODEL = "旅梯減碳模型";
const OWNER = `「${ALGORITHM}」由「阿德」負責`;
const LOCATED = `「${MODEL}」的程式碼放在大量交織的 GitHub 組織底下的 calculator 專案裡`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** Sends the input; returns its proposal card. */
async function input(page: Page, fact: string) {
  const card = (
    await send(page, `請把以下內容輸入到知識庫：${fact}`)
  ).getByRole("region", { name: "提案" });
  await expect(card).toBeVisible();
  return card;
}

/** Marks the fact naming the subject 過時, so later specs never meet it. */
async function retire(page: Page, subject: string) {
  const card = (await send(page, `${subject}已經過時`)).getByRole("region", {
    name: "提案",
  });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");
}

test("a new entity relinked to an existing one makes its name an alias: asking by it finds the entity's facts", async ({
  page,
}) => {
  const first = await input(page, OWNER);
  const entities = first.getByRole("group", { name: "實體" });
  await expect(entities).toContainText(`${ALGORITHM}新實體`);
  await expect(entities).toContainText("阿德新實體");
  await first.getByRole("button", { name: "確認" }).click();
  await expect(first).toContainText("已確認");

  const second = await input(page, LOCATED);
  await expect(second.getByRole("group", { name: "實體" })).toContainText(
    `${MODEL}新實體`,
  );
  await second
    .getByRole("combobox", { name: `「${MODEL}」連到` })
    .selectOption({ label: ALGORITHM });
  await expect(second.getByRole("group", { name: "實體" })).toHaveText(
    ALGORITHM,
  );
  await page.screenshot({ path: test.info().outputPath("relink.png") });
  await second.getByRole("button", { name: "確認" }).click();
  await expect(second).toContainText("已確認");
  await expect(second.getByRole("group", { name: "實體" })).toHaveText(
    ALGORITHM,
  );

  const { answer } = await askFollowUp(page, `${MODEL}由誰負責？`);

  await expect(answer.getByRole("list", { name: "出處" })).toContainText(OWNER);
  await page.screenshot({ path: test.info().outputPath("alias-answer.png") });

  await retire(page, ALGORITHM);
  await retire(page, MODEL);
});
