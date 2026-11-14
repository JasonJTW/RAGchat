import { expect, test } from "@playwright/test";
import { ask, send } from "./ask";

// 去識別 as a 成員 sees it (ADR-0004): the knowledge base stores pseudonyms
// (server tests check the tables), yet every card and citation shows the
// real values; a secret is refused. Runs on the local analyzer.
const FACT = "王小明先生負責倉儲盤點表，手機 0912-345-678";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("an input with a name shows the name on its card and in the citation", async ({
  page,
}) => {
  const reply = await send(page, `請把以下內容輸入到知識庫：${FACT}`);

  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("listitem")).toContainText(FACT);
  await expect(card).not.toContainText("〔");
  await page.screenshot({ path: test.info().outputPath("card.png") });
  await card.getByRole("button", { name: "確認" }).click();
  await expect(card).toContainText("已確認");

  // Asked by the real name in a new conversation: retrieval finds the fact
  // stored under its pseudonym.
  const { answer } = await ask(page, `${FACT}？`);
  const citation = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem")
    .first();
  await citation.locator("summary").click();
  await expect(citation.getByText(FACT, { exact: true })).toBeVisible();
  await expect(answer).not.toContainText("〔");
  await page.screenshot({ path: test.info().outputPath("cited.png") });
});

test("a term is marked sensitive on a card", async ({ page }) => {
  const reply = await send(
    page,
    "請把以下內容輸入到知識庫：阿德負責週三的回收箱",
  );
  const card = reply.getByRole("region", { name: "提案" });

  await card.getByText("標記敏感詞").click();
  await card.getByRole("textbox", { name: "用詞" }).fill("阿德");
  await card.getByRole("button", { name: "設為敏感" }).click();

  await expect(card.getByRole("status")).toHaveText(
    "已設為敏感：之後的輸入會以代稱取代「阿德」",
  );
  await page.screenshot({ path: test.info().outputPath("marked.png") });
  await card.getByRole("button", { name: "拒絕" }).click();
  await expect(card).toContainText("已拒絕");
});

test("a message with a password is refused, with no card", async ({ page }) => {
  const reply = await send(
    page,
    "請把以下內容輸入到知識庫：測試站帳號 admin，密碼是 Hunter2024!",
  );

  await expect(reply).toContainText("這則內容含有密碼或 API key");
  await expect(reply.getByRole("region", { name: "提案" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("secret.png") });
});
