import type { Identity } from "./auth.js";

// Stub sign-in for tests and E2E (STUB_AUTH=1): a cookie names the user and
// whether they are a 成員, standing in for a Clerk session. auth.ts honours
// it only while no CLERK_SECRET_KEY is set and NODE_ENV is not production.

export const STUB_SESSION_COOKIE = "stub_session";

/** The Cookie header of a stub session (same format as web/e2e/sign-in.ts). */
export function stubSession(userId: string, role: Identity["role"]): string {
  return `${STUB_SESSION_COOKIE}=${encodeURIComponent(`${userId}:${role}`)}`;
}

/** The identity a stub session cookie names, or null. */
export function stubIdentity(
  cookieHeader: string | undefined,
): Identity | null {
  for (const pair of cookieHeader?.split(";") ?? []) {
    const [name, ...rest] = pair.trim().split("=");
    if (name !== STUB_SESSION_COOKIE) continue;
    const match = /^(user_[\w-]+):(member|guest)$/.exec(
      decodeURIComponent(rest.join("=")),
    );
    return match
      ? { userId: match[1], role: match[2] as Identity["role"] }
      : null;
  }
  return null;
}
