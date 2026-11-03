import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./e2e/admin-login";

// Override to run beside another checkout's E2E run.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 4100);

export default defineConfig({
  testDir: "./e2e",
  // Live tests (tagged @live) call the real LLM; run them with `npm run test:live`.
  grepInvert: process.env.LIVE ? undefined : /@live/,
  // Tests share one stateful server (the document list), so run them one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests get their own web + server on separate ports, never the developer's
  // `npm run dev` on :3000/:4000, so test uploads can't leak into it.
  webServer: [
    {
      command: "npm run dev -w server",
      cwd: "..",
      env: {
        PORT: String(SERVER_PORT),
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
        // A fresh, empty document store per run, never the dev server/data/.
        DATA_DIR: mkdtempSync(path.join(tmpdir(), "kb-e2e-")),
        // The full suite must not reach a real model: blank the key and use
        // fake embeddings unless running live tests. (Shell env wins over the
        // root .env file.)
        ...(process.env.LIVE
          ? {}
          : { AI_GATEWAY_API_KEY: "", STUB_MODELS: "1" }),
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
