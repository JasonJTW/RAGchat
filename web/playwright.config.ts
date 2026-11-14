import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { MEMBER_COOKIE } from "./e2e/sign-in";

// Override to run beside another checkout's E2E run.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 4100);

// The E2E server's own database on the developer's Postgres (DATABASE_URL from
// the shell, then the root .env, else the docker compose default), created
// before the server starts and dropped by e2e/global-teardown.ts. Set once in
// env, since workers load this file again.
process.env.E2E_DATABASE_URL ??= (() => {
  const url = new URL(
    process.env.DATABASE_URL ||
      rootEnv().DATABASE_URL ||
      "postgres://ragchat:ragchat@localhost:5433/ragchat",
  );
  url.pathname = `/ragchat_e2e_${randomBytes(6).toString("hex")}`;
  return url.href;
})();

// The E2E server's own pseudonym key (ADR-0004), never the one in .env: its
// database is new, so it has no pseudonyms another key could read.
process.env.E2E_PSEUDONYM_KEY ??= randomBytes(32).toString("base64");

function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(path.join(__dirname, "../.env"), "utf8"));
  } catch {
    return {};
  }
}

const STUB_AUTH = {
  STUB_AUTH: "1",
  CLERK_SECRET_KEY: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
};

export default defineConfig({
  testDir: "./e2e",
  // Live tests (tagged @live) call the real LLM; run them with `npm run test:live`.
  grepInvert: process.env.LIVE ? undefined : /@live/,
  // Tests share one stateful server (the team workspace's knowledge base), so
  // run them one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Live answers vary run to run: about 1 in 25 takes over 5 s to its first
  // word on the model's side alone (ticket 12's Strikes), so retry them once.
  retries: process.env.CI ? 2 : process.env.LIVE ? 1 : 0,
  reporter: "html",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    // Signed in as a 成員 by the stub session (STUB_AUTH=1 below); specs
    // about signing in override it.
    storageState: { cookies: [MEMBER_COOKIE], origins: [] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests get their own web + server on separate ports, never the developer's
  // `npm run dev` on :3000/:4000, so test uploads can't leak into it.
  webServer: [
    {
      // The server migrates the new database on startup.
      command: "npm run db:create -w server && npm run dev -w server",
      cwd: "..",
      env: {
        PORT: String(SERVER_PORT),
        DATABASE_URL: process.env.E2E_DATABASE_URL,
        // Sign-in is faked by a cookie (e2e/sign-in.ts), never real Clerk,
        // live runs included. A Clerk key would turn the stub off.
        ...STUB_AUTH,
        // The full suite must not reach a real model: blank the keys and use
        // fake models unless running live tests. (Shell env wins over the
        // root .env file.)
        ...(process.env.LIVE
          ? {}
          : { AI_GATEWAY_API_KEY: "", JEV_API_KEY: "", STUB_MODELS: "1" }),
        PSEUDONYM_ENCRYPTION_KEY: process.env.E2E_PSEUDONYM_KEY,
        // De-identification finds values with the local analyzer (CI has no
        // Presidio sidecar); live runs use the real one (`npm run
        // presidio:up`, PRESIDIO_URL or :5002).
        PII_ANALYZER: process.env.LIVE ? "" : "local",
      },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx next dev -p ${WEB_PORT}`,
      env: {
        SERVER_URL: `http://localhost:${SERVER_PORT}`,
        ...STUB_AUTH,
        NEXT_DIST_DIR: ".next-e2e",
      },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
