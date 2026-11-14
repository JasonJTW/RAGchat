import { defineConfig } from "vitest/config";

// `npm run test:live -w server`: the *.live.test.ts files, against the real
// models (AI Gateway, Jev) and the Presidio sidecar, on a database of the
// run's own (vitest.global-setup.ts). Never part of `npm test` or CI.
export default defineConfig({
  test: {
    include: ["src/**/*.live.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.live.setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 3_600_000,
  },
});
