import { defineConfig } from "eslint/config";

import { baseConfig } from "@llm-bench/eslint-config/base";
import { nextjsConfig } from "@llm-bench/eslint-config/nextjs";
import { reactConfig } from "@llm-bench/eslint-config/react";

export default defineConfig(
  { ignores: [".next/**", "next-env.d.ts"] },
  baseConfig,
  reactConfig,
  nextjsConfig,
);
