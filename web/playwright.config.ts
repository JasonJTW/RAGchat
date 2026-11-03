import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
const SERVER_PORT = 4100;

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
        // The full suite must not reach a real model: blank the key unless
        // running live tests. (Shell env wins over the root .env file.)
        ...(process.env.LIVE ? {} : { AI_GATEWAY_API_KEY: "" }),
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
