import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { askFollowUp, send } from "./ask";
import { signIn } from "./sign-in";

// Conversations are saved per 成員. Each test signs in as 成員 of its own so
// conversations other tests leave don't show up in its list.
const member = (name: string) => `user_e2e_${name}_${randomUUID().slice(0, 8)}`;

test("a 成員 reopens an earlier conversation from the list and continues it", async ({
  page,
}) => {
  await signIn(page, "member", member("history"));
  await page.goto("/");
  const list = page.getByRole("navigation", { name: "對話紀錄" });
  const answers = page.getByRole("article", { name: "回答" });
  /** Opens a listed conversation and waits until the chat shows it. */
  const open = async (title: string) => {
    const link = list.getByRole("link", { name: title });
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("main").locator("p", { hasText: title }),
    ).toBeVisible();
  };

  await askFollowUp(page, "旅梯計畫巡迴了幾站？");
  await expect(list.getByRole("link")).toHaveText(["旅梯計畫巡迴了幾站？"]);

  await page.getByRole("button", { name: "新對話" }).click();
  await expect(answers).toHaveCount(0);
  await askFollowUp(page, "避免排放怎麼算？");
  await expect(list.getByRole("link")).toHaveText([
    "避免排放怎麼算？",
    "旅梯計畫巡迴了幾站？",
  ]);

  // Without a reload, the first conversation reopens with what was said.
  await open("旅梯計畫巡迴了幾站？");
  await expect(answers).toHaveCount(1);

  // A reload keeps nothing in the page; the list comes from the server.
  await page.reload();
  await open("旅梯計畫巡迴了幾站？");
  await expect(answers).toHaveCount(1);

  await askFollowUp(page, "那是哪幾年？");
  await expect(answers).toHaveCount(2);
  await expect(list.getByRole("link")).toHaveText([
    "旅梯計畫巡迴了幾站？",
    "避免排放怎麼算？",
  ]);
  await page.reload();
  await open("避免排放怎麼算？");
  await expect(answers).toHaveCount(1);
  await open("旅梯計畫巡迴了幾站？");
  await expect(answers).toHaveCount(2);
});

test("a 成員 doesn't see another 成員's conversations", async ({ page }) => {
  await signIn(page, "member", member("writer"));
  await page.goto("/");
  await askFollowUp(page, "誰負責避免排放算法？");
  const list = page.getByRole("navigation", { name: "對話紀錄" });
  await expect(list.getByRole("link")).toHaveText(["誰負責避免排放算法？"]);

  await signIn(page, "member", member("reader"));
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "問題" })).toBeVisible();
  await expect(list.getByText("還沒有對話")).toBeVisible();
  await expect(list.getByRole("link")).toHaveCount(0);
});

test("a reopened conversation shows its proposal card as it stands now", async ({
  page,
}) => {
  await signIn(page, "member", member("stale"));
  await page.goto("/");
  const fact = `重開對話時的提案 ${randomUUID().slice(0, 8)}`;
  const reply = await send(page, `請把以下內容輸入到知識庫：${fact}`);
  const card = reply.getByRole("region", { name: "提案" });
  await expect(card.getByRole("button", { name: "確認" })).toBeVisible();
  const id = await page.evaluate(() =>
    new URL(location.href).searchParams.get("c"),
  );

  // Confirmed elsewhere (another tab, the /proposals page).
  const pending = (await (await page.request.get("/api/proposals")).json()) as {
    id: string;
    items: { content?: string }[];
  }[];
  const proposal = pending.find((p) => p.items[0]?.content === fact)!;
  expect(
    (await page.request.post(`/api/proposals/${proposal.id}/confirm`)).ok(),
  ).toBe(true);

  await page.goto(`/?c=${id}`);
  const reopened = page
    .getByRole("article", { name: "回答" })
    .getByRole("region", { name: "提案" });
  await expect(reopened).toContainText("已確認，已寫入知識庫。");
  await expect(reopened.getByRole("button", { name: "確認" })).toHaveCount(0);
});
