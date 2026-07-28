import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunnerExtensionOperations } from "./cli-app";
import { RunnerCli } from "./cli-app";
import { RunnerStateStore } from "./state";

describe("RunnerCli", () => {
  const roots: string[] = [];
  const rawKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const runnerId = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("logs in with device code and revokes the runner on logout", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-cli-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    const output: string[] = [];
    const revoked: string[] = [];
    const cli = new RunnerCli({
      state,
      output: (line) => output.push(line),
      keyPair: () =>
        Promise.resolve({
          publicKey: rawKey,
          privateKey: rawKey,
        }),
      probe: () => ({
        capabilities: ["workspaces", "files"],
        inventory: { plugins: [], mcpProfiles: [] },
        environment: {
          os: "linux",
          architecture: "arm64",
          cpuClass: "fixture",
          memoryMb: 8192,
          runtimeVersions: { node: "22.21.0" },
          harnessVersions: {},
          sandboxMode: "process",
          contentHashes: {},
        },
        issues: [],
      }),
      pairing: {
        start: () =>
          Promise.resolve({
            deviceCode: "device-code",
            userCode: "USER-CODE",
            verificationUri: "https://bench.example/pair",
            expiresAt: "2026-07-01T10:10:00.000Z",
            intervalSeconds: 1,
          }),
        poll: () =>
          Promise.resolve({
            status: "approved" as const,
            runnerId,
            token: "runner-token",
          }),
      },
      transport: () => ({
        logout: (runnerId) => {
          revoked.push(runnerId);
          return Promise.resolve();
        },
        heartbeat: () => Promise.resolve(),
      }),
      lifecycle: {
        start: () => Promise.resolve(123),
        stop: () => Promise.resolve(),
        isRunning: () => true,
      },
      sleep: () => Promise.resolve(),
    });

    await cli.run(["login", "https://bench.example", "fixture-runner"]);
    expect(await state.credentials()).toMatchObject({ token: "runner-token" });
    expect(output).toContain(
      "Open https://bench.example/pair and enter USER-CODE",
    );

    await cli.run(["logout"]);
    expect(revoked).toEqual([runnerId]);
    expect(await state.credentials()).toBeNull();
  });

  it("starts, reports, diagnoses, probes, and stops the local runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-cli-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    await state.saveCredentials({
      serverUrl: "https://bench.example",
      runnerId,
      token: "runner-token",
      publicKey: rawKey,
      privateKey: rawKey,
    });
    const output: string[] = [];
    const running = new Set<number>();
    const cli = new RunnerCli({
      state,
      output: (line) => output.push(line),
      keyPair: () => Promise.resolve({ publicKey: "", privateKey: "" }),
      probe: () => ({
        capabilities: ["workspaces", "files"],
        inventory: { plugins: [], mcpProfiles: [] },
        environment: {
          os: "linux",
          architecture: "arm64",
          cpuClass: "fixture",
          memoryMb: 8192,
          runtimeVersions: { node: "22.21.0" },
          harnessVersions: {},
          sandboxMode: "process",
          contentHashes: {},
        },
        issues: [],
      }),
      pairing: {
        start: () => Promise.reject(new Error("unused")),
        poll: () => Promise.reject(new Error("unused")),
      },
      transport: () => ({
        logout: () => Promise.resolve(),
        heartbeat: () => Promise.resolve(),
      }),
      lifecycle: {
        start: () => {
          running.add(123);
          return Promise.resolve(123);
        },
        stop: (pid) => {
          running.delete(pid);
          return Promise.resolve();
        },
        isRunning: (pid) => running.has(pid),
      },
      sleep: () => Promise.resolve(),
    });

    await cli.run(["status"]);
    await cli.run(["start"]);
    await cli.run(["status"]);
    await cli.run(["doctor"]);
    await cli.run(["capabilities"]);
    await cli.run(["stop"]);

    expect(output).toEqual([
      "Runner stopped.",
      "Runner started (pid 123).",
      "Runner running (pid 123).",
      "Doctor: healthy.",
      '{"capabilities":["workspaces","files"],"inventory":{"plugins":[],"mcpProfiles":[]},"environment":{"os":"linux","architecture":"arm64","cpuClass":"fixture","memoryMb":8192,"runtimeVersions":{"node":"22.21.0"},"harnessVersions":{},"sandboxMode":"process","contentHashes":{}}}',
      "Runner stopped.",
    ]);
  });

  it("rejects invalid command states and waits for pending pairing", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-cli-"));
    roots.push(root);
    const state = new RunnerStateStore(join(root, "state"));
    let pending = true;
    let expired = false;
    let probeIssues: string[] = [];
    let runningPid: number | null = null;
    let sleeps = 0;
    const cli = new RunnerCli({
      state,
      output: () => undefined,
      keyPair: () => Promise.resolve({ publicKey: rawKey, privateKey: rawKey }),
      probe: () => ({
        capabilities: ["workspaces", "files"],
        inventory: { plugins: [], mcpProfiles: [] },
        environment: {
          os: "linux",
          architecture: "arm64",
          cpuClass: "fixture",
          memoryMb: 1024,
          runtimeVersions: { node: "22.21.0" },
          harnessVersions: {},
          sandboxMode: "process",
          contentHashes: {},
        },
        issues: probeIssues,
      }),
      pairing: {
        start: () =>
          Promise.resolve({
            deviceCode: "device",
            userCode: "CODE",
            verificationUri: "https://bench.example/pair",
            expiresAt: expired
              ? "2000-01-01T00:00:00.000Z"
              : "2999-01-01T00:00:00.000Z",
            intervalSeconds: 1,
          }),
        poll: () => {
          if (pending) {
            pending = false;
            return Promise.resolve({ status: "pending" as const });
          }
          return Promise.resolve({
            status: "approved" as const,
            runnerId,
            token: "token",
          });
        },
      },
      transport: () => ({
        logout: () => Promise.resolve(),
        heartbeat: () => Promise.resolve(),
      }),
      lifecycle: {
        start: () => Promise.resolve(123),
        stop: () => Promise.resolve(),
        isRunning: (pid) => pid === runningPid,
      },
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    });

    await expect(cli.run([])).rejects.toThrow("Unknown runner command");
    await expect(cli.run(["unknown"])).rejects.toThrow(
      "Unknown runner command",
    );
    await expect(cli.run(["login"])).rejects.toThrow("Usage:");
    await expect(cli.run(["logout"])).rejects.toThrow("not logged in");
    await expect(cli.run(["start"])).rejects.toThrow("not logged in");
    await expect(cli.run(["doctor"])).rejects.toThrow("not logged in");

    await cli.run(["login", "https://bench.example", "runner"]);
    expect(sleeps).toBe(1);
    runningPid = 123;
    await state.saveProcessId(123);
    await expect(cli.run(["start"])).rejects.toThrow("already running");
    runningPid = null;
    await cli.run(["status"]);
    await state.saveProcessId(456);
    await cli.run(["stop"]);
    probeIssues = ["Node unavailable"];
    await expect(cli.run(["doctor"])).rejects.toThrow("Node unavailable");
    await expect(cli.run(["start"])).rejects.toThrow("Node unavailable");
    await expect(
      cli.run(["login", "https://bench.example", "unsupported"]),
    ).rejects.toThrow("Node unavailable");

    probeIssues = [];
    expired = true;
    pending = true;
    await expect(
      cli.run(["login", "https://bench.example", "expired"]),
    ).rejects.toThrow("Pairing code has expired.");
  });

  it("routes explicit plugin and MCP operator commands without exposing local config", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-cli-"));
    roots.push(root);
    const output: string[] = [];
    const calls: string[] = [];
    const extensions = extensionFixture(calls);
    const cli = extensionCli(
      new RunnerStateStore(join(root, "state")),
      output,
      extensions,
    );

    await cli.run(["plugin", "add", "/plugin", "--jsonl"]);
    await cli.run(["plugin", "probe", "/plugin"]);
    await cli.run(["plugin", "list"]);
    await cli.run(["plugin", "grant", "fixture", "TOKEN", "RUNNER_TOKEN"]);
    await cli.run(["plugin", "revoke", "fixture", "TOKEN"]);
    await cli.run(["plugin", "remove", "fixture"]);
    await cli.run(["mcp", "add", "/profiles/filesystem.json"]);
    await cli.run(["mcp", "list"]);
    await cli.run(["mcp", "probe", "filesystem"]);
    await cli.run(["mcp", "start", "filesystem"]);
    await cli.run(["mcp", "capabilities", "filesystem"]);
    await cli.run(["mcp", "stop", "filesystem"]);
    await cli.run(["mcp", "remove", "filesystem"]);
    await cli.run(["capabilities"]);

    expect(calls).toEqual([
      "plugin:add:/plugin,--jsonl",
      "plugin:probe:/plugin",
      "plugin:list",
      "plugin:grant:fixture:TOKEN:RUNNER_TOKEN",
      "plugin:revoke:fixture:TOKEN",
      "plugin:remove:fixture",
      "mcp:add:/profiles/filesystem.json",
      "mcp:list",
      "mcp:probe:filesystem",
      "mcp:probe:filesystem",
      "mcp:probe:filesystem",
      "mcp:stop:filesystem",
      "mcp:remove:filesystem",
    ]);
    expect(output.join("\n")).not.toContain("/opt/private");
    expect(output.join("\n")).not.toContain("RUNNER_TOKEN");
  });

  it("makes malformed extension commands actionable", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-cli-"));
    roots.push(root);
    const cli = extensionCli(
      new RunnerStateStore(join(root, "state")),
      [],
      extensionFixture([]),
    );
    for (const arguments_ of [
      ["plugin"],
      ["plugin", "add"],
      ["plugin", "probe"],
      ["plugin", "remove"],
      ["plugin", "grant"],
      ["plugin", "revoke"],
      ["mcp"],
      ["mcp", "add"],
      ["mcp", "remove"],
      ["mcp", "probe"],
      ["mcp", "start"],
      ["mcp", "capabilities"],
      ["mcp", "stop"],
    ]) {
      await expect(cli.run(arguments_)).rejects.toThrow();
    }
    const unavailable = extensionCli(
      new RunnerStateStore(join(root, "other-state")),
      [],
    );
    await expect(unavailable.run(["plugin", "list"])).rejects.toThrow(
      "extension management is unavailable",
    );
  });
});

function extensionCli(
  state: RunnerStateStore,
  output: string[],
  extensions?: RunnerExtensionOperations,
): RunnerCli {
  return new RunnerCli({
    state,
    output: (line) => output.push(line),
    keyPair: () => Promise.reject(new Error("unused")),
    probe: () => ({
      capabilities: [],
      inventory: { plugins: [], mcpProfiles: [] },
      environment: {
        os: "linux",
        architecture: "arm64",
        cpuClass: "fixture",
        memoryMb: 1024,
        runtimeVersions: {},
        harnessVersions: {},
        sandboxMode: "process",
        contentHashes: {},
      },
      issues: [],
    }),
    pairing: {
      start: () => Promise.reject(new Error("unused")),
      poll: () => Promise.reject(new Error("unused")),
    },
    transport: () => ({
      logout: () => Promise.resolve(),
      heartbeat: () => Promise.resolve(),
    }),
    lifecycle: {
      start: () => Promise.reject(new Error("unused")),
      stop: () => Promise.resolve(),
      isRunning: () => false,
    },
    sleep: () => Promise.resolve(),
    ...(extensions === undefined ? {} : { extensions }),
  });
}

function extensionFixture(calls: string[]): RunnerExtensionOperations {
  return {
    inventory: () => Promise.resolve({ plugins: [], mcpProfiles: [] }),
    plugin: {
      add: (argv) => {
        calls.push(`plugin:add:${argv.join(",")}`);
        return Promise.resolve({ id: "fixture" });
      },
      probe: (argv) => {
        calls.push(`plugin:probe:${argv.join(",")}`);
        return Promise.resolve({ id: "fixture" });
      },
      list: () => {
        calls.push("plugin:list");
        return Promise.resolve([{ id: "fixture" }]);
      },
      grant: (id, pluginName, runnerName) => {
        calls.push(`plugin:grant:${id}:${pluginName}:${runnerName}`);
        return Promise.resolve();
      },
      revoke: (id, pluginName) => {
        calls.push(`plugin:revoke:${id}:${pluginName}`);
        return Promise.resolve();
      },
      remove: (id) => {
        calls.push(`plugin:remove:${id}`);
        return Promise.resolve();
      },
    },
    mcp: {
      add: (path) => {
        calls.push(`mcp:add:${path}`);
        return Promise.resolve();
      },
      list: () => {
        calls.push("mcp:list");
        return Promise.resolve([{ id: "filesystem" }]);
      },
      probe: (id) => {
        calls.push(`mcp:probe:${id}`);
        return Promise.resolve({ capabilities: { tools: {} } });
      },
      stop: (id) => {
        calls.push(`mcp:stop:${id}`);
        return Promise.resolve();
      },
      remove: (id) => {
        calls.push(`mcp:remove:${id}`);
        return Promise.resolve();
      },
    },
  };
}
