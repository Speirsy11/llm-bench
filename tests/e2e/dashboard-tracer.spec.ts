import { mkdtemp, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  RunnerHttpTransport,
  RunnerStateStore,
  RunnerWorker,
  TracerExecutor,
} from "../../packages/runner/dist/e2e.js";

const BASE_URL = "http://127.0.0.1:3007";
const SERVER_LOG = "/tmp/llm-bench-e2e-server.log";
const PLAINTEXT_CANARY = "sk-or-v1-e2e-plaintext-canary-7f3a-key";
const RUNNER_KEYS = {
  publicKey: "qIMX/mDRho8Xaxyi0NHbkpy0ztugnO/lZNtjPKPKSQQ=",
  privateKey: "zizI/i4hm6JGMFcOIrhmFjiFBio6+eOqkBoehLpYVcY=",
};

test.describe.configure({ mode: "serial" });

test("a browser-sealed dashboard job is executed by the paired runner and survives refresh", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const e2eHeaders = {
    "x-llm-bench-e2e-token": String(testInfo.config.metadata.e2eToken),
  };
  const runnerRoot = await mkdtemp(join(tmpdir(), "llm-bench-e2e-runner-"));
  const browserSubmissions: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.method() === "POST" && outgoing.url().startsWith(BASE_URL)) {
      browserSubmissions.push(outgoing.postData() ?? "");
    }
  });

  try {
    await page.setExtraHTTPHeaders(e2eHeaders);
    await expect(
      (await request.post("/api/e2e/reset", { headers: e2eHeaders })).json(),
    ).resolves.toEqual({ reset: true });

    const pairing = await startPairing(request);
    await page.goto("/api/e2e/session");
    await expect(page).toHaveURL(/\/dashboard$/u);
    await page.goto("/dashboard/runners/pair");
    await page.getByLabel("Runner pairing code").fill(pairing.userCode);
    await page.getByRole("button", { name: "Pair runner" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Runner paired. You can close this page.",
    );

    const credentials = await pollPairing(request, pairing.deviceCode);
    await heartbeat(request, credentials.token);

    await page.goto("/dashboard");
    await expect(
      page.getByText("Fixture runner", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("OpenRouter API key").fill(PLAINTEXT_CANARY);
    await page.getByRole("button", { name: "Save credential" }).click();
    await expect(page.getByRole("status")).toHaveText("Credential saved.");
    await expect(page.getByLabel("OpenRouter API key")).toHaveValue("");

    await page.reload();
    await expect(page.getByText("openrouter · ••••-key")).toBeVisible();
    await page
      .getByLabel("OpenRouter · meta-llama/llama-3.1-70b-instruct")
      .uncheck();
    await page.getByLabel("Confirm unknown spend").check();
    await page.getByRole("button", { name: "Launch experiment" }).click();
    await expect(
      page.getByText("openrouter-gpt-4o · llmbench", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("queued", { exact: true })).toBeVisible();

    const providerAudit = {
      authorizationMatched: false,
      requestBodies: [] as string[],
    };
    const worker = new RunnerWorker({
      state: new RunnerStateStore(runnerRoot),
      transport: new RunnerHttpTransport({
        serverUrl: BASE_URL,
        token: credentials.token,
      }),
      executor: new TracerExecutor(runnerRoot, {
        identity: {
          runnerId: credentials.runnerId,
          ...RUNNER_KEYS,
        },
        openRouterFetch: fixtureProvider(providerAudit),
      }),
    });

    await expect.poll(() => worker.runOnce()).toBe("completed");
    expect(providerAudit.authorizationMatched).toBe(true);
    expect(providerAudit.requestBodies.join("\n")).not.toContain(
      PLAINTEXT_CANARY,
    );

    await page.reload();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Hidden test pass ratio:")).toBeVisible();
    await expect(page.getByText("1", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Hidden test pass ratio:")).toBeVisible();
    await expect(page.getByText("1", { exact: true })).toBeVisible();

    expect(browserSubmissions.join("\n")).not.toContain(PLAINTEXT_CANARY);
    const persisted = await (
      await request.get("/api/e2e/persistence", { headers: e2eHeaders })
    ).text();
    expect(persisted).not.toContain(PLAINTEXT_CANARY);
    const serverLog = await readFile(SERVER_LOG, "utf8");
    expect(serverLog).not.toContain(PLAINTEXT_CANARY);
    expect(await scanRunnerRoot(runnerRoot)).not.toContain(PLAINTEXT_CANARY);
  } finally {
    await rm(runnerRoot, { recursive: true, force: true });
  }
});

async function scanRunnerRoot(root: string): Promise<string> {
  const pending = [root];
  const contents: string[] = [];
  let remainingBytes = 5 * 1024 * 1024;

  while (pending.length > 0 && remainingBytes > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        const size = Math.min(
          (await stat(path)).size,
          1024 * 1024,
          remainingBytes,
        );
        if (size === 0) continue;
        const handle = await open(path, "r");
        try {
          const buffer = Buffer.alloc(size);
          const { bytesRead } = await handle.read(buffer, 0, size, 0);
          contents.push(buffer.subarray(0, bytesRead).toString("utf8"));
          remainingBytes -= bytesRead;
        } finally {
          await handle.close();
        }
      }
    }
  }

  return contents.join("\n");
}

async function startPairing(request: APIRequestContext) {
  const response = await request.post("/api/v1/runner/pairings", {
    data: {
      protocolVersion: "2.0",
      name: "Fixture runner",
      publicKey: RUNNER_KEYS.publicKey,
      capabilities: ["response_generation", "workspaces", "files"],
      environment: {
        os: "linux",
        architecture: "x64",
        cpuClass: "fixture",
        memoryMb: 4096,
        runtimeVersions: { node: "22.21.0" },
        harnessVersions: { llmbench: "1.0.0" },
        sandboxMode: "e2e-fixture",
        contentHashes: {},
      },
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { deviceCode: string; userCode: string };
}

async function pollPairing(
  request: APIRequestContext,
  deviceCode: string,
): Promise<{ runnerId: string; token: string }> {
  const response = await request.get(
    `/api/v1/runner/pairings/${encodeURIComponent(deviceCode)}`,
  );
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    status: "pending" | "approved";
    runnerId?: string;
    token?: string;
  };
  expect(body.status).toBe("approved");
  expect(body.runnerId).toBeTruthy();
  expect(body.token).toBeTruthy();
  return { runnerId: body.runnerId!, token: body.token! };
}

async function heartbeat(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await request.post("/api/v1/runner/heartbeat", {
    headers: { authorization: `Bearer ${token}` },
    data: { protocolVersion: "2.0", status: "online" },
  });
  expect(response.ok()).toBe(true);
}

function fixtureProvider(audit: {
  authorizationMatched: boolean;
  requestBodies: string[];
}) {
  let calls = 0;
  return (_url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    audit.authorizationMatched =
      headers.authorization === `Bearer ${PLAINTEXT_CANARY}`;
    audit.requestBodies.push(body);
    calls += 1;
    return Promise.resolve(
      Response.json(
        calls === 1
          ? {
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "e2e-patch",
                        function: {
                          name: "apply_patch",
                          arguments: JSON.stringify({
                            path: "src/clamp.cjs",
                            oldText: `function clamp(value, lower, upper) {
  // BUG: returns the input unchanged, ignoring the bounds.
  return value;
}
module.exports = { clamp };
`,
                            newText: `function clamp(value, lower, upper) {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}
module.exports = { clamp };
`,
                          }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            }
          : {
              choices: [
                {
                  message: { content: "Fixed." },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
              },
            },
      ),
    );
  };
}
