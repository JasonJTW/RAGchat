import { expect, test } from "@playwright/test";
import { send } from "./ask";
import { signIn } from "./sign-in";

// A 訪客 signs up, passes the (stub) human check and lands in their own
// 試用工作區 with the 示範資料. Each test is a new 訪客.

test.beforeEach(async ({ page }) => {
  await signIn(page, "guest", `user_e2e_guest_${Date.now()}`);
  await page.goto("/");
  await page.getByRole("button", { name: /開始試用/ }).click();
  await expect(page.getByRole("region", { name: "試用工作區" })).toBeVisible();
});

test("a 訪客 gets the 示範資料, example questions and the example file", async ({
  page,
}) => {
  const guide = page.getByRole("region", { name: "試試看" });
  await expect(guide.getByRole("button")).toHaveText([
    "避免排放算法現在怎麼算？",
    "為什麼決定在公式裡加入壽命比？",
    "三月時我們的避免排放公式是什麼？",
    "附加範例檔",
  ]);

  await guide.getByRole("button", { name: "避免排放算法現在怎麼算？" }).click();
  await expect(page.getByRole("textbox", { name: "問題" })).toHaveValue(
    "避免排放算法現在怎麼算？",
  );
  await page.getByRole("button", { name: "送出" }).click();
  const answer = page.getByRole("article", { name: "回答" });
  await expect(answer.getByRole("list", { name: "出處" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("trial-answer.png") });

  await guide.getByRole("button", { name: "附加範例檔" }).click();
  await expect(page.getByRole("list", { name: "附件" })).toContainText(
    "meeting-2026-11-12.txt",
  );
  await page.getByRole("button", { name: "送出" }).click();
  const card = page.getByRole("article", { name: "回答" }).nth(1);
  await expect(card.getByRole("button", { name: /確認/ }).first()).toBeVisible({
    timeout: 30_000,
  });
  // The example replaces the seed's formula.
  await expect(card.getByRole("heading")).toContainText("取代");
  const replaced = card
    .getByRole("listitem")
    .filter({ has: page.getByLabel("新", { exact: true }) })
    .filter({ hasText: "A = W × EF × R × L − T" });
  await expect(replaced.getByLabel("舊")).toContainText("A = W × EF × R × L，");
  // A 訪客's trial is not de-identified: no 敏感詞 to mark.
  await expect(card.getByText("標記敏感詞")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("trial-upload.png") });
});

test("a 訪客 resets the trial to the 示範資料", async ({ page }) => {
  await send(page, "請把以下內容輸入到知識庫：試用時新增的事實");
  await expect(
    page.getByRole("navigation", { name: "對話紀錄" }),
  ).toContainText("試用時新增的事實");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "重設試用工作區" }).click();

  await expect(
    page.getByRole("navigation", { name: "對話紀錄" }),
  ).toContainText("還沒有對話");
  await expect(page.getByRole("region", { name: "試用工作區" })).toBeVisible();
});

test("a 訪客 is told clearly when a file is over the trial's 1 MB", async ({
  page,
}) => {
  await page.getByLabel("選擇附件").setInputFiles({
    name: "big.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(1024 * 1024 + 10, "a"),
  });
  await page.getByRole("button", { name: "送出" }).click();

  await expect(page.getByText("試用時每個檔案最大 1 MB。")).toHaveAttribute(
    "role",
    "alert",
  );
  await page.screenshot({ path: test.info().outputPath("trial-limit.png") });
});
