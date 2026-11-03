import { expect, test } from "@playwright/test";
import { logIn, upload } from "./admin-login";
import { ask } from "./ask";

// The E2E server's fake chat model always streams this reply (see
// server/src/stub-models.ts), citing the best-matching passage.
const STUB_REPLY = "這是假模型的回答，依據第 1 段。[1]";

test("an answer streams in and cites the passage it marks", async ({
  page,
}) => {
  await logIn(page);
  await upload(page, "05-projects-and-practice.md");

  const { answer, text, distinctLengths } = await ask(
    page,
    "旅梯計畫總共巡迴了幾站？是哪幾年？",
  );

  expect(text).toBe(STUB_REPLY);
  expect(distinctLengths).toBeGreaterThan(5);
  const citations = answer
    .getByRole("list", { name: "出處" })
    .getByRole("listitem");
  await expect(citations).toHaveCount(1);
  const citation = citations.first();
  await expect(citation).toContainText(/^\[1\] .+\.md › /);
  const passage = citation.getByRole("paragraph");
  await expect(passage).toBeHidden();
  await citation.getByText(/\.md › /).click();
  await expect(passage).toBeVisible();
  await expect(passage).not.toBeEmpty();
});
