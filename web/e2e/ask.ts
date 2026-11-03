import { expect, type Page } from "@playwright/test";

/**
 * Opens a new conversation, asks the question, and waits for the answer to
 * finish. Returns the answer, its text without the citations, how long the
 * first character took, and how many distinct lengths the text grew through.
 */
export async function ask(page: Page, question: string) {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { answerLengths: number[] };
    w.answerLengths = [];
    new MutationObserver(() => {
      const text = document.querySelector('article[aria-label="回答"] > p');
      if (text) w.answerLengths.push(text.textContent?.length ?? 0);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page.getByRole("textbox", { name: "問題" }).fill(question);
  const sentAt = Date.now();
  await page.getByRole("button", { name: "送出" }).click();

  const answer = page.getByRole("article", { name: "回答" });
  const text = answer.locator(":scope > p");
  await expect(text).not.toBeEmpty({ timeout: 5_000 });
  const firstCharMs = Date.now() - sentAt;
  await expect(page.getByRole("button", { name: "送出" })).toBeEnabled({
    timeout: 120_000,
  });
  const lengths = await page.evaluate(
    () => (window as unknown as { answerLengths: number[] }).answerLengths,
  );
  return {
    answer,
    text: (await text.textContent()) ?? "",
    firstCharMs,
    distinctLengths: new Set(lengths.filter((n) => n > 0)).size,
  };
}
