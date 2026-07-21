import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const e2eToken = randomBytes(32).toString("hex");
process.env.LLMBENCH_E2E_TOKEN = e2eToken;

export default defineConfig({
  metadata: { e2eToken },
  testDir: "tests/e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3007",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "apps/web/node_modules/.bin/next dev apps/web --hostname 127.0.0.1 --port 3007 2>&1 | tee /tmp/llm-bench-e2e-server.log",
    env: {
      ...process.env,
      AUTH_SECRET: "00000000000000000000000000000000",
      AUTH_GITHUB_ID: "e2e-client",
      AUTH_GITHUB_SECRET: "e2e-secret",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://llmbench:llmbench@127.0.0.1:5432/llmbench_e2e_test",
      LLMBENCH_ADMIN_GITHUB_LOGINS: "e2e",
      LLMBENCH_E2E_ENABLED: "1",
      LLMBENCH_E2E_TOKEN: e2eToken,
    },
    url: "http://127.0.0.1:3007/e2e/dashboard-tracer",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
