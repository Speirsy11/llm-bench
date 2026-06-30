import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@llm-bench/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    esbuild: {
      jsx: "automatic",
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: [
          "src/**/*.test.ts",
          "src/**/*.test.tsx",
          "src/app/**",
          "src/auth.ts",
          "src/proxy.ts",
        ],
        thresholds: {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  }),
);
