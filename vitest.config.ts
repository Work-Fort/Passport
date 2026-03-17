import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    globalSetup: "./src/test/global-setup.ts",
    env: {
      BETTER_AUTH_SECRET: "test-secret",
    },
  },
});
