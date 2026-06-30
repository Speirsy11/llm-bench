import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@llm-bench/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      fileParallelism: false,
      hookTimeout: 120_000,
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts", "src/index.ts", "src/schema.ts"],
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  }),
);
