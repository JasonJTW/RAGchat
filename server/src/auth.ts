import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";

const COOKIE = "admin_session";

// Session tokens live in memory: restarting the server logs the admin out.
const sessions = new Set<string>();

// Hashing first gives equal-length buffers, so the comparison doesn't leak
// the length or prefix of the secret through timing.
function same(a: string, b: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

const Credentials = z.object({ username: z.string(), password: z.string() });

/** True while `ADMIN_PASSWORD` is unset: nobody can log in. */
export function adminPasswordMissing(): boolean {
  return !process.env.ADMIN_PASSWORD;
}

// Read on every request so the credentials come from the current env.
function credentialsMatch({
  username,
  password,
}: z.infer<typeof Credentials>): boolean {
  const userOk = same(username, process.env.ADMIN_USERNAME || "admin");
  const passwordOk = same(password, process.env.ADMIN_PASSWORD ?? "");
  return userOk && passwordOk;
}

function sessionToken(cookieHeader: string | undefined): string | undefined {
  for (const pair of cookieHeader?.split(";") ?? []) {
    const [name, ...value] = pair.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
}

/** Starts an admin session (httpOnly cookie) when the credentials match. */
export const login: RequestHandler = (req, res) => {
  const credentials = Credentials.safeParse(req.body);
  if (!credentials.success) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  if (adminPasswordMissing()) {
    res.status(503).json({ error: "ADMIN_PASSWORD is not set" });
    return;
  }
  if (!credentialsMatch(credentials.data)) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  sessions.add(token);
  res
    .cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" })
    .status(204)
    .end();
};

/** Rejects requests without a valid admin session with 401. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  const token = sessionToken(req.headers.cookie);
  if (token && sessions.has(token)) return next();
  res.status(401).json({ error: "unauthorized" });
};
