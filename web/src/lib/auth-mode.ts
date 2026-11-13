// How the web app signs people in: Clerk, or, in tests and E2E, a stub cookie
// (STUB_AUTH=1, see web/e2e/sign-in.ts). The stub never runs beside a real
// Clerk key or in production, the same rule as server/src/auth.ts. Server-only.

/** True when sign-in is faked by the stub session cookie. */
export function stubAuth(): boolean {
  return (
    process.env.STUB_AUTH === "1" &&
    !process.env.CLERK_SECRET_KEY &&
    process.env.NODE_ENV !== "production"
  );
}

/** True when Clerk is configured, so people can really sign in. */
export function clerkConfigured(): boolean {
  return (
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}

export const STUB_SESSION_COOKIE = "stub_session";
