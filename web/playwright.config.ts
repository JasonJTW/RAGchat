import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./e2e/admin-login";

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

function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(path.join(__dirname, "../.env"), "utf8"));
  } catch {
    return {};
  }
}

export default defineConfig({
  testDir: "./e2e",
  // Live tests (tagged @live) call the real LLM; run them with `npm run test:live`.
  grepInvert: process.env.LIVE ? undefined : /@live/,
  // Tests share one stateful server (the document list), so run them one at a time.
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
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
        // A fresh, empty document store per run, never the dev server/data/.
        DATA_DIR: mkdtempSync(path.join(tmpdir(), "kb-e2e-")),
        // The full suite must not reach a real model: blank the keys and use
        // fake models unless running live tests. (Shell env wins over the
        // root .env file.)
        ...(process.env.LIVE
          ? {}
          : { AI_GATEWAY_API_KEY: "", JEV_API_KEY: "", STUB_MODELS: "1" }),
      },
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx next dev -p ${WEB_PORT}`,
      env: {
        SERVER_URL: `http://localhost:${SERVER_PORT}`,
        NEXT_DIST_DIR: ".next-e2e",
      },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
