import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    sequence: {
      concurrent: false,
    },
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/live/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**/*.ts"],
    },
  },
});
