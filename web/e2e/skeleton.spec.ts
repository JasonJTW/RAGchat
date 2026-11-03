import path from "node:path";
import { expect, test } from "@playwright/test";

const UPLOADS = path.join(
  __dirname,
  "../../.scratch/kb-chatbot/fixtures/upload",
);

test("walking skeleton: chat streams an answer, admin lists an upload", async ({
  page,
}) => {
  // Step 1: the answer grows character by character and ends with 1 citation.
  await page.goto("/");
  await page.evaluate(() => {
    const lengths: number[] = [];
    (window as unknown as { answerLengths: number[] }).answerLengths = lengths;
    new MutationObserver(() => {
      const answer = document.querySelector('article[aria-label="回答"] p');
      if (answer) lengths.push(answer.textContent?.length ?? 0);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  await page.getByRole("textbox", { name: "問題" }).fill("交換物品要付錢嗎？");
  await page.getByRole("button", { name: "送出" }).click();

  const answer = page.getByRole("article", { name: "回答" }).last();
  await expect(answer).toContainText(
    "這是骨架的假回答，之後會換成依文件產生的回答。",
    { timeout: 5000 },
  );
  await expect(answer.getByRole("listitem")).toHaveCount(1);

  const lengths = await page.evaluate(
    () => (window as unknown as { answerLengths: number[] }).answerLengths,
  );
  const distinct = new Set(lengths.filter((n) => n > 0));
  expect(distinct.size).toBeGreaterThan(5);

  // Step 2: uploading 01-overview.md adds a row with 0 chunks.
  await page.goto("/admin");
  const row = page.getByRole("row", { name: /01-overview\.md/ });
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  const before = await row.count();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "選擇檔案" }).click();
  await (await chooser).setFiles(path.join(UPLOADS, "01-overview.md"));
  await page.getByRole("button", { name: "上傳" }).click();

  await expect(row).toHaveCount(before + 1);
  await expect(
    row.last().getByRole("cell", { name: "0", exact: true }),
  ).toBeVisible();
});
