import { expect, test } from "@playwright/test";
import { ask } from "./ask";
import { signIn } from "./sign-in";
import { sendFiles } from "./sources";

// 硬刪除 (spec story 45): the uploader of a 來源 deletes it from its card;
// its facts and passages leave the knowledge base, so answers no longer cite
// them. Nobody else is offered the deletion.

const FACT = "彩虹計畫的倉庫鑰匙放在三號櫃";
const QUESTION = "彩虹計畫的倉庫鑰匙放在三號櫃嗎？";

test("the uploader deletes a file 來源 from its card, and answers stop citing it", async ({
  page,
}) => {
  await page.goto("/");
  const reply = await sendFiles(page, [
    { name: "rainbow-keys.md", buffer: Buffer.from(`# 鑰匙\n\n${FACT}。\n`) },
  ]);
  const card = reply.getByRole("region", { name: "提案" });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");

  await expect(page).toHaveURL(/\?c=/);
  const conversation = page.url();

  const before = await ask(page, QUESTION);
  await expect(before.answer.getByRole("list", { name: "出處" })).toContainText(
    FACT,
  );

  // Back in the conversation the file was attached in, its card is there.
  await page.goto(conversation);
  const saved = page.getByRole("region", { name: "提案" });
  await saved.getByText("刪除來源").click();
  await expect(saved.getByRole("group", { name: "刪除來源" })).toContainText(
    "由它產生的事實",
  );
  await page.screenshot({ path: test.info().outputPath("delete-offered.png") });
  await saved.getByRole("button", { name: "永久刪除" }).click();
  await expect(saved.getByRole("status")).toHaveText(/來源已刪除/);
  await page.screenshot({ path: test.info().outputPath("deleted.png") });

  const after = await ask(page, QUESTION);
  // Neither the answer nor its citations (other specs' facts may be cited).
  await expect(after.answer).not.toContainText(FACT);
  await expect(after.answer).not.toContainText("rainbow-keys.md");
  await page.screenshot({ path: test.info().outputPath("not-cited.png") });
});

test("another 成員 is not offered to delete someone's 來源", async ({
  page,
}) => {
  const fact = "彩虹計畫的係數 Q 代表數量";
  await signIn(page, "member", "user_e2e_other");
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "問題" })
    .fill(`請把以下內容輸入到知識庫：${fact}`);
  await page.getByRole("button", { name: "送出" }).click();
  const own = page
    .getByRole("region", { name: "提案" })
    .filter({ hasText: fact });
  await expect(own.getByText("刪除來源")).toBeVisible();

  // A fresh page load, so the page asks who is signed in again.
  await signIn(page, "member", "user_e2e_member");
  await page.goto("/proposals");
  const theirs = page
    .getByRole("region", { name: "提案" })
    .filter({ hasText: fact });
  await expect(theirs).toContainText("user_e2e_other 提出");
  await expect(theirs.getByText("刪除來源")).toHaveCount(0);

  // The uploader deletes it, so later specs see no pending proposal of it.
  await signIn(page, "member", "user_e2e_other");
  await page.goto("/proposals");
  const mine = page
    .getByRole("region", { name: "提案" })
    .filter({ hasText: fact });
  await mine.getByText("刪除來源").click();
  await mine.getByRole("button", { name: "永久刪除" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "來源已刪除" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(fact)).toHaveCount(0);
});
