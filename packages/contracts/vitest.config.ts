import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@llm-bench/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts"],
        // Barrel exports and test files carry no behavior of their own.
        exclude: ["src/**/*.test.ts", "src/index.ts"],
        thresholds: {
          // Foundation contracts enforce the 100% policy documented in README.
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  }),
);
