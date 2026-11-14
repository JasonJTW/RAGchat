import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ask } from "./ask";

// Ticket #33: Jev's subject check on the team wiki's first messages, against
// the real Jev. The knowledge base may be empty: only whether the chat asks
// back is checked, not the answer.

/** The server reads a key from the shell, else the root .env (shell wins). */
function hasKey(name: string): boolean {
  if (name in process.env) return !!process.env[name];
  const env = path.join(__dirname, "../../.env");
  return (
    existsSync(env) &&
    new RegExp(`^${name}=\\S`, "m").test(readFileSync(env, "utf8"))
  );
}

const CLARIFY = "請問你指的是哪個計畫或主題？";

const UNNAMED = ["它是什麼時候決定的？", "當初是誰提議的？"];
const NAMED = ["避免排放估算公式現在是什麼？", "上次會議為什麼決定用壽命比？"];
// Input keywords skip Jev, even when the subject is a pronoun.
const INPUT = ["更新一下，它現在改成每週四開會"];

test.describe("subject check @live", () => {
  test.skip(
    !hasKey("AI_GATEWAY_API_KEY") || !hasKey("JEV_API_KEY"),
    "AI_GATEWAY_API_KEY or JEV_API_KEY is not set",
  );

  for (const question of UNNAMED)
    test(`asks back: ${question}`, async ({ page }) => {
      const { text, answer } = await ask(page, question);
      expect(text).toBe(CLARIFY);
      await expect(answer.getByRole("list", { name: "出處" })).toHaveCount(0);
    });

  for (const question of [...NAMED, ...INPUT])
    test(`does not ask back: ${question}`, async ({ page }) => {
      test.setTimeout(120_000);
      const { text } = await ask(page, question);
      expect(text).not.toBe(CLARIFY);
    });
});
