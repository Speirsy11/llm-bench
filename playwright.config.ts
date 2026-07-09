import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3007",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "SKIP_ENV_VALIDATION=true pnpm --filter @llm-bench/web dev --hostname 127.0.0.1 --port 3007",
    url: "http://127.0.0.1:3007/e2e/dashboard-tracer",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
