import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@llm-bench/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      exclude: ["src/**/*.integration.test.ts"],
    },
  }),
);
