import { expect, test, type Page } from "@playwright/test";
import { openDocuments, removeAllDocuments } from "./documents";
import { askFollowUp } from "./ask";

const FACT =
  "我們目前的避免排放算法模型是 估算值 A = m × EF × 取代率 R × 壽命比 L";
const INPUT = `請把以下內容輸入到知識庫：${FACT}`;

/** Sends a message in the conversation on the page; returns its reply. */
async function send(page: Page, text: string) {
  const replies = page.getByRole("article", { name: "回答" });
  const earlier = await replies.count();
  await page.getByRole("textbox", { name: "問題" }).fill(text);
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.getByRole("button", { name: "送出" })).toBeEnabled({
    timeout: 30_000,
  });
  return replies.nth(earlier);
}

test.beforeEach(async ({ page }) => {
  // Only the knowledge base answers: earlier tests' documents are removed.
  await openDocuments(page);
  await removeAllDocuments(page);
  await page.goto("/");
});

test("an input is confirmed into the knowledge base, and the next answer cites it", async ({
  page,
}) => {
  const reply = await send(page, INPUT);

  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("listitem")).toHaveText([FACT]);
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
