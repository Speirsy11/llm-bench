import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@llm-bench/vitest-config/base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.integration.test.ts"],
      fileParallelism: false,
      hookTimeout: 120_000,
    },
  }),
);
