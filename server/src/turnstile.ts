// Cloudflare Turnstile: whether a 訪客 passed the human check. The web gets a
// token from the widget (NEXT_PUBLIC_TURNSTILE_SITE_KEY); the server checks
// it at Cloudflare with TURNSTILE_SECRET_KEY. Tests and E2E stub it
// (STUB_TURNSTILE=1: the token "stub-pass" passes), never in production.

export const STUB_TURNSTILE_TOKEN = "stub-pass";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** True when the stub check is on; refused in production. */
export function stubTurnstile(): boolean {
  return (
    process.env.STUB_TURNSTILE === "1" && process.env.NODE_ENV !== "production"
  );
}

/** Problems with the Turnstile env, for the server to report at startup. */
export function turnstileWarnings(): string[] {
  if (stubTurnstile()) return ["STUB_TURNSTILE=1: the human check is faked."];
  if (!process.env.TURNSTILE_SECRET_KEY)
    return ["TURNSTILE_SECRET_KEY is not set: no 訪客 can start a trial."];
  return [];
}

/**
 * Whether the token shows a human, as Cloudflare says. False without a
 * secret key; throws when Cloudflare can't be reached. No `remoteip` is
 * sent: behind the Next rewrite and cloudflared the server sees only the
 * web container's address, and a forwarded header could be forged.
 */
export async function passesTurnstile(token: string): Promise<boolean> {
  if (stubTurnstile()) return token === STUB_TURNSTILE_TOKEN;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetch(SITEVERIFY, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Turnstile siteverify: ${res.status}`);
  const { success } = (await res.json()) as { success?: boolean };
  return success === true;
}
