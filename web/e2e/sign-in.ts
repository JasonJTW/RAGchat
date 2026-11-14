import type { Page } from "@playwright/test";

// The E2E server and web run with STUB_AUTH=1 (playwright.config.ts): this
// cookie stands in for a Clerk session. Same format as server/src/stub-auth.ts.
// Specs start signed in as MEMBER (the config's storageState).

export type Role = "member" | "guest";

/** Signs the page's browser in as a 成員 (default) or a 訪客. */
export async function signIn(
  page: Page,
  role: Role = "member",
  userId = `user_e2e_${role}`,
) {
  await page.context().addCookies([
    {
      name: "stub_session",
      value: encodeURIComponent(`${userId}:${role}`),
      domain: "localhost",
      path: "/",
    },
  ]);
}

/** The stub session cookie of a 成員, for the config's storageState. */
export const MEMBER_COOKIE = {
  name: "stub_session",
  value: encodeURIComponent("user_e2e_member:member"),
  domain: "localhost",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: "Lax" as const,
};
