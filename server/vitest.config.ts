import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Live tests reach the real models: `npm run test:live` (vitest.live.config.ts).
    exclude: [...configDefaults.exclude, "**/*.live.test.ts"],
  },
});
