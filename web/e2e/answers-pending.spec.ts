import { expect, test, type Locator, type Page } from "@playwright/test";
import { askFollowUp, send } from "./ask";

// 待確認 facts in answers, and a message that both corrects and asks. The
// stub answer cites [1]; the stub models read 「X 不是 A，是 B」 as a 取代 and
// 「X 已經過時」 as a 過時 (server/src/stub-models.ts). Questions repeat a fact
// word for word, so it ranks first among the 待確認 facts of the shared team
// workspace. Confirmed facts always come before 待確認 ones, so this spec
// runs (alphabetically) before knowledge-base.spec, which leaves confirmed
// facts behind.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function proposed(page: Page, text: string): Promise<Locator> {
  const card = (await send(page, text)).getByRole("region", { name: "提案" });
  await expect(card).toBeVisible();
  return card;
}

async function decideOn(card: Locator, button: "確認" | "拒絕") {
  await card.getByRole("button", { name: button }).click();
  await expect(card).toContainText(button === "確認" ? "已確認" : "已拒絕");
}

/** The answer's citations (not the items of a card inside one), expanded. */
async function citations(answer: Locator) {
  const items = answer
    .getByRole("list", { name: "出處" })
    .locator(":scope > li");
  for (const item of await items.all())
    await item.locator(":scope > details > summary").click();
  return items;
}

/** Marks the fact 過時, so later specs see no current fact of it. */
async function retire(page: Page, fact: string, subject: string) {
  await page.goto("/");
  await askFollowUp(page, fact);
  await decideOn(await proposed(page, `${subject} 已經過時`), "確認");
}

test("an answer uses a 待確認 fact, labelled so, and it can be confirmed from the answer", async ({
  page,
}) => {
  const fact = "天河計畫的係數 K 代表密度";
  await proposed(page, `請把以下內容輸入到知識庫：${fact}`);

  const { answer } = await askFollowUp(page, fact);

  const [citation] = await (await citations(answer)).all();
  await expect(citation.locator(":scope > details > summary")).toContainText(
    "待確認",
  );
  await expect(citation.getByText(fact, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("pending-cited.png") });
  await decideOn(citation.getByRole("region", { name: "提案" }), "確認");

  const again = await askFollowUp(page, fact);
  const [confirmed] = await (await citations(again.answer)).all();
  await expect(confirmed.locator(":scope > details > summary")).toContainText(
    "知識庫",
  );
  await expect(
    confirmed.locator(":scope > details > summary"),
  ).not.toContainText("待確認");
  await retire(page, fact, "天河計畫的係數 K");
});

test("a confirmed fact and a 待確認 one replacing it are cited side by side, the confirmed first", async ({
  page,
}) => {
  const fact = "天河計畫的係數 M 代表質量";
  const replacement = "天河計畫的係數 M 代表重量";
  await decideOn(
    await proposed(page, `請把以下內容輸入到知識庫：${fact}`),
    "確認",
  );
  await askFollowUp(page, fact);
  const correction = await proposed(page, "天河計畫的係數 M 不是質量，是重量");

  const { answer } = await askFollowUp(page, fact);

  const items = await citations(answer);
  await expect(items).toHaveCount(2);
  await expect(
    items.nth(0).locator(":scope > details > summary"),
  ).toContainText("知識庫");
  await expect(items.nth(0)).toContainText(fact);
  await expect(
    items.nth(1).locator(":scope > details > summary"),
  ).toContainText("待確認");
  await expect(items.nth(1)).toContainText(replacement);
  await page.screenshot({ path: test.info().outputPath("side-by-side.png") });

  await decideOn(correction, "拒絕");
  await retire(page, fact, "天河計畫的係數 M");
});

test("a message that corrects and asks gets a correction proposal and an answer noting it is pending", async ({
  page,
}) => {
  const fact = "天河計畫的係數 N 代表取代率";
  await decideOn(
    await proposed(page, `請把以下內容輸入到知識庫：${fact}`),
    "確認",
  );
  await askFollowUp(page, fact);

  const reply = await send(
    page,
    "天河計畫的係數 N 不是取代率，是回收率，那現在 A 怎麼算？",
  );

  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("heading")).toContainText("取代");
  await expect(card.getByLabel("舊")).toHaveText(fact);
  await expect(card.getByLabel("新")).toHaveText("天河計畫的係數 N 代表回收率");
  await expect(reply).toContainText("你剛提出的修正還待確認");
  await expect(reply.getByRole("list", { name: "出處" })).toContainText(
    "知識庫",
  );
  await page.screenshot({ path: test.info().outputPath("multi-intent.png") });

  await decideOn(card, "確認");
  await retire(page, "天河計畫的係數 N 代表回收率", "天河計畫的係數 N");
});
