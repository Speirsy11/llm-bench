import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const emptyModule = fileURLToPath(
  new URL("./empty-module.ts", import.meta.url),
);

/**
 * Shared Vitest base. Packages merge this with a `vitest.config.ts` that sets
 * the environment (`node` for backend, `jsdom` for frontend) and `include`
 * globs. Env validation is skipped so tests don't require real secrets, and the
 * `server-only`/`client-only` guards are stubbed so server modules can be
 * imported in tests.
 */
export default defineConfig({
  test: {
    globals: true,
    env: {
      NODE_ENV: "test",
      SKIP_ENV_VALIDATION: "true",
    },
    mockReset: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "server-only": emptyModule,
      "client-only": emptyModule,
    },
  },
});
