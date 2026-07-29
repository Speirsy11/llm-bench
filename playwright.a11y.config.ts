import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

import { requireTestDatabaseUrl } from "./apps/web/src/app/api/e2e/guard";

const e2eToken = randomBytes(32).toString("hex");
const testDatabaseUrl = requireTestDatabaseUrl(
  process.env.TEST_DATABASE_URL ??
    "postgresql://llmbench:llmbench@127.0.0.1:5432/llmbench_e2e_test",
);
process.env.LLMBENCH_E2E_TOKEN = e2eToken;

export default defineConfig({
  metadata: { e2eToken },
  testDir: "tests/a11y",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3008",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm db:test:reset && pnpm db:migrate && apps/web/node_modules/.bin/next dev apps/web --hostname 127.0.0.1 --port 3008 2>&1 | tee /tmp/llm-bench-a11y-server.log",
    env: {
      ...process.env,
      AUTH_SECRET: "00000000000000000000000000000000",
      AUTH_GITHUB_ID: "a11y-client",
      AUTH_GITHUB_SECRET: "a11y-secret",
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      LLMBENCH_ADMIN_GITHUB_LOGINS: "e2e",
      LLMBENCH_E2E_ENABLED: "1",
      LLMBENCH_E2E_TOKEN: e2eToken,
    },
    url: "http://127.0.0.1:3008/results",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
