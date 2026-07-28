import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { startMcpSession, startMcpUnixBridge } from "./index";

const execFileAsync = promisify(execFile);

describe("startMcpSession", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("probes a runner-local stdio server with only explicitly resolved secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "server.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
const observed = {
  HOME: process.env.HOME,
  CODEX_HOME: process.env.CODEX_HOME,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ARBITRARY_ENV: process.env.ARBITRARY_ENV,
  MCP_TOKEN: process.env.MCP_TOKEN,
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write("\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: observed } },
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: observed } },
    }) + "\\n");
  }
});
`,
      { mode: 0o700 },
    );
    await chmod(fixture, 0o700);
    const session = await startMcpSession(
      {
        metadata: {
          protocolVersion: "1",
          id: "fixture",
          version: "1.0.0",
          contentHash: "a".repeat(64),
          label: "Fixture",
          capabilities: ["tools"],
          tools: ["read_file"],
        },
        local: {
          argv: [process.execPath, fixture],
          secretReferences: { MCP_TOKEN: "keychain:fixture" },
        },
      },
      (reference) =>
        Promise.resolve(
          reference === "keychain:fixture" ? "resolved-token" : undefined,
        ),
      { signal: new AbortController().signal },
    );

    expect(session.capabilities).toBeUndefined();

    await expect(session.probe(new AbortController().signal)).resolves.toEqual({
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: {
          HOME: undefined,
          CODEX_HOME: undefined,
          OPENAI_API_KEY: undefined,
          ARBITRARY_ENV: undefined,
          MCP_TOKEN: "resolved-token",
        },
      },
    });
    expect(session.capabilities).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: {
        tools: {
          HOME: undefined,
          CODEX_HOME: undefined,
          OPENAI_API_KEY: undefined,
          ARBITRARY_ENV: undefined,
          MCP_TOKEN: "resolved-token",
        },
      },
    });
    await session.stop();
    await expect(session.stop()).resolves.toBeUndefined();
  });

  it("bridges a real child tools/list request to the initialized stdio session", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-bridge-"));
    roots.push(root);
    const server = join(root, "server.mjs");
    const client = join(root, "client.mjs");
    await writeFile(
      server,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "notifications/initialized") {
    globalThis.initialized = true;
    return;
  }
  const result = request.method === "initialize"
    ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
    : globalThis.initialized
      ? { tools: [{ name: "fixture_echo", description: "Echo a value", inputSchema: { type: "object" } }] }
      : { blocked: true };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});`,
    );
    await writeFile(
      client,
      `import { createConnection } from "node:net";
let buffer = "";
const socket = createConnection(process.argv[2], () => {
  socket.write(JSON.stringify({ jsonrpc: "2.0", id: "plugin-1", method: "tools/list", params: {} }) + "\\n");
});
socket.on("data", (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf("\\n");
  if (newline === -1) return;
  process.stdout.write(buffer.slice(0, newline));
  socket.end();
});`,
    );
    const session = await startMcpSession(profileFor(server), () =>
      Promise.resolve(undefined),
    );
    await session.probe();
    const bridgeRoot = join(root, "job-bridge");
    const bridge = await startMcpUnixBridge(session, {
      root: bridgeRoot,
      socketName: "filesystem.sock",
    });

    expect((await stat(bridgeRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(bridge.socketPath)).mode & 0o777).toBe(0o600);
    const response = await execFileAsync(process.execPath, [
      client,
      bridge.socketPath,
    ]);
    expect(JSON.parse(response.stdout)).toEqual({
      jsonrpc: "2.0",
      id: "plugin-1",
      result: {
        tools: [
          {
            name: "fixture_echo",
            description: "Echo a value",
            inputSchema: { type: "object" },
          },
        ],
      },
    });

    await bridge.stop();
    await expect(access(bridge.socketPath)).rejects.toThrow();
    await session.stop();
  });

  it("buffers a JSON-RPC response until its terminating newline arrives", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "split-response.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", () => {
  const response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: { tools: {} } } });
  process.stdout.write(response.slice(0, 24));
  setTimeout(() => process.stdout.write(response.slice(24) + "\\n"), 10);
});`,
    );
    const session = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );

    await expect(session.probe()).resolves.toEqual({
      capabilities: { tools: {} },
      protocolVersion: undefined,
    });
    await session.stop();
  });

  it("ignores unrelated replies while waiting for the initialize response", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "correlated-initialize.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method !== "initialize") return;
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0", id: 99,
    result: { protocolVersion: "wrong", capabilities: { tools: { wrong: true } } },
  }) + "\\n");
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0", id: request.id,
    result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
  }) + "\\n");
});`,
    );
    const session = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );

    await expect(session.probe()).resolves.toEqual({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
    });
    await session.stop();
  });

  it("cleans up timed-out and cancelled requests without poisoning later requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "request-lifecycle.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
let requests = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, result: { capabilities: { tools: {} } },
    }) + "\\n");
    return;
  }
  if (request.method === "tools/list") {
    requests += 1;
    if (requests < 3) return;
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", method: "notifications/progress", params: {},
    }) + "\\n");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "healthy" }] },
    }) + "\\n");
  }
});`,
    );
    const session = await startMcpSession(
      profileFor(fixture),
      () => Promise.resolve(undefined),
      { requestTimeoutMs: 30 },
    );
    await session.probe();

    await expect(session.request("tools/list")).rejects.toThrow(
      "timed out after 30ms",
    );
    const controller = new AbortController();
    const cancelled = session.request("tools/list", {}, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    const healthySignal = new AbortController();
    await expect(
      session.request("tools/list", {}, healthySignal.signal),
    ).resolves.toEqual({
      tools: [{ name: "healthy" }],
    });
    await session.stop();
  });

  it("fails closed before initialization, on server errors, and after shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "request-errors.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, result: { capabilities: {} },
    }) + "\\n");
  } else if (request.method === "tools/call") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
      error: { code: -32601, message: "tool missing" },
    }) + "\\n");
  } else if (request.method === "tools/null-error") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, error: null,
    }) + "\\n");
  } else if (request.method === "tools/message-only") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, error: { message: "message only" },
    }) + "\\n");
  } else if (request.method === "tools/code-only") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id, error: { code: -32000 },
    }) + "\\n");
  } else if (request.method === "tools/malformed") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: request.id,
    }) + "\\n");
  } else if (request.method === "exit") {
    process.exit(0);
  }
});`,
    );
    const session = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );
    await expect(session.request("tools/list")).rejects.toThrow(
      "has not initialized",
    );
    await session.probe();
    await expect(
      session.request("tools/call", {}, new AbortController().signal),
    ).rejects.toThrow("tool missing (JSON-RPC -32601)");
    await expect(session.request("tools/null-error")).rejects.toThrow(
      "MCP server returned an error.",
    );
    await expect(session.request("tools/message-only")).rejects.toThrow(
      "message only",
    );
    await expect(session.request("tools/code-only")).rejects.toThrow(
      "MCP server returned an error. (JSON-RPC -32000)",
    );
    await expect(session.request("tools/malformed")).rejects.toThrow(
      "invalid JSON-RPC response",
    );
    await expect(session.request("tools/list")).rejects.toThrow("not running");

    const exited = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );
    await exited.probe();
    await expect(exited.request("exit")).rejects.toThrow(
      "exited before replying",
    );
  });

  it("validates bridge requests, contains failures, and makes cleanup idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-bridge-"));
    roots.push(root);
    await expect(
      startMcpUnixBridge(
        { request: () => Promise.resolve({}) },
        {
          root,
          socketName: "../escape.sock",
        },
      ),
    ).rejects.toThrow("safe basename");

    const observed: unknown[] = [];
    const bridge = await startMcpUnixBridge(
      {
        request: (method, params) => {
          observed.push({ method, params });
          return Promise.reject(new Error("runner-local failure"));
        },
      },
      { root: join(root, "bridge"), socketName: "job.sock" },
    );
    const malformed = await socketRequest(bridge.socketPath, "not-json");
    expect(malformed).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603 },
    });
    expect(JSON.stringify(malformed)).toContain("JSON");
    await expect(socketRequest(bridge.socketPath, "null")).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Invalid JSON-RPC request." },
    });
    for (const invalid of [
      { jsonrpc: "1.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", method: "tools/list" },
      { jsonrpc: "2.0", id: 1 },
    ]) {
      await expect(
        socketRequest(bridge.socketPath, JSON.stringify(invalid)),
      ).resolves.toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Invalid JSON-RPC request." },
      });
    }
    await expect(
      socketRequest(
        bridge.socketPath,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
        }),
      ),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32603, message: "runner-local failure" },
    });
    expect(observed).toEqual([{ method: "tools/call", params: {} }]);
    await expect(
      startMcpUnixBridge(
        { request: () => Promise.resolve({}) },
        { root: join(root, "bridge"), socketName: "job.sock" },
      ),
    ).rejects.toThrow();
    await expect(
      socketRequest(bridge.socketPath, "x".repeat(1024 * 1024 + 1)),
    ).rejects.toThrow();

    await unlink(bridge.socketPath);
    await bridge.stop();
    await expect(bridge.stop()).resolves.toBeUndefined();

    const unlinkFailure = await startMcpUnixBridge(
      { request: () => Promise.resolve({}) },
      { root: join(root, "unlink-failure"), socketName: "job.sock" },
    );
    await unlink(unlinkFailure.socketPath);
    await mkdir(unlinkFailure.socketPath);
    await expect(unlinkFailure.stop()).rejects.toThrow();
  });

  it("does not launch a server when an explicitly requested secret is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const marker = join(root, "started");
    const fixture = join(root, "server.mjs");
    await writeFile(
      fixture,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "started");`,
    );

    await expect(
      startMcpSession(
        profileFor(fixture, { MCP_TOKEN: "keychain:missing" }),
        () => Promise.resolve(undefined),
      ),
    ).rejects.toThrow("could not be resolved");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(access(marker)).rejects.toThrow();
  });

  it("stops the whole server process group when startup probing times out", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "server.mjs");
    const child = join(root, "child.mjs");
    const ready = join(root, "ready");
    const marker = join(root, "child-finished");
    await writeFile(
      child,
      `import { writeFileSync } from "node:fs"; setTimeout(() => writeFileSync(process.argv[2], "bad"), 350);`,
    );
    await writeFile(
      fixture,
      `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: "ignore" });
writeFileSync(process.argv[4], "ready");
setInterval(() => {}, 1_000);`,
    );
    const session = await startMcpSession(
      profileFor(fixture, {}, [child, marker, ready]),
      () => Promise.resolve(undefined),
      {
        startupTimeoutMs: 30,
      },
    );
    await waitForFile(ready);

    await expect(session.probe()).rejects.toThrow(
      "did not initialize within 30ms",
    );
    await expect(session.stop()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 450));
    await expect(access(marker)).rejects.toThrow();
  });

  it("rejects a probe and cleans up when server output exceeds its bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "server.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", () => process.stdout.write("x".repeat(256)));`,
    );
    const session = await startMcpSession(
      profileFor(fixture),
      () => Promise.resolve(undefined),
      {
        maxOutputBytes: 32,
      },
    );

    await expect(session.probe()).rejects.toThrow("output exceeded 32 bytes");
    await expect(session.stop()).resolves.toBeUndefined();
  });

  it("cancels an in-flight probe and accepts a cached capability result", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "server.mjs");
    const silent = join(root, "silent.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }) + "\\n");
});`,
    );
    await writeFile(silent, "setInterval(() => {}, 1_000);");
    const first = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );
    await expect(first.probe()).resolves.toEqual({
      capabilities: {},
      protocolVersion: undefined,
    });
    await expect(first.probe()).resolves.toEqual({
      capabilities: {},
      protocolVersion: undefined,
    });
    await first.stop();
    await expect(first.probe()).resolves.toEqual({
      capabilities: {},
      protocolVersion: undefined,
    });

    const second = await startMcpSession(profileFor(silent), () =>
      Promise.resolve(undefined),
    );
    const controller = new AbortController();
    const pending = second.probe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    await expect(second.stop()).resolves.toBeUndefined();
  });

  it("rejects malformed server replies and an exited server without leaking a live session", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const malformed = join(root, "malformed.mjs");
    const exits = join(root, "exits.mjs");
    await writeFile(
      malformed,
      `import { createInterface } from "node:readline"; createInterface({ input: process.stdin }).on("line", () => process.stdout.write("not-json\\n"));`,
    );
    await writeFile(exits, "process.exit(0);");

    const bad = await startMcpSession(profileFor(malformed), () =>
      Promise.resolve(undefined),
    );
    await expect(bad.probe(new AbortController().signal)).rejects.toThrow(
      "invalid initialize response",
    );
    await expect(bad.stop()).resolves.toBeUndefined();
    const stopped = await startMcpSession(profileFor(exits), () =>
      Promise.resolve(undefined),
    );
    await expect(stopped.probe()).rejects.toThrow(
      "exited before initialization",
    );
    await expect(stopped.stop()).resolves.toBeUndefined();
    await expect(stopped.probe()).rejects.toThrow("not running");
  });

  it("rejects a pre-cancelled session before resolving secrets", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      startMcpSession(
        profileFor(process.execPath),
        () => Promise.resolve("secret"),
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow("cancelled");
  });

  it("cancels during secret resolution before launching a child", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const controller = new AbortController();
    let release!: () => void;
    const resolving = startMcpSession(
      profileFor(process.execPath, { MCP_TOKEN: "keychain:delayed" }),
      () =>
        new Promise((resolve) => {
          release = () => resolve("secret");
        }),
      { signal: controller.signal },
    );
    controller.abort();
    release();

    await expect(resolving).rejects.toThrow("cancelled");
  });

  it("rejects invalid JSON-RPC response shapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    for (const [index, response] of [
      "null",
      JSON.stringify({ jsonrpc: "2.0", id: 1 }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: [] } }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { capabilities: {}, protocolVersion: 1 },
      }),
    ].entries()) {
      const fixture = join(root, `invalid-${index}.mjs`);
      await writeFile(
        fixture,
        `import { createInterface } from "node:readline"; createInterface({ input: process.stdin }).on("line", () => process.stdout.write(${JSON.stringify(response + "\n")}));`,
      );
      const session = await startMcpSession(profileFor(fixture), () =>
        Promise.resolve(undefined),
      );
      await expect(session.probe()).rejects.toThrow(
        "invalid initialize response",
      );
      await session.stop();
    }
  });

  it("rejects a concurrent probe and terminates an option-level cancelled session", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "silent.mjs");
    await writeFile(fixture, "setInterval(() => {}, 1_000);");
    const session = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );
    const initial = session.probe();
    await expect(session.probe()).rejects.toThrow("already running");
    await session.stop();
    await expect(initial).rejects.toThrow("exited before initialization");

    const controller = new AbortController();
    const cancelled = await startMcpSession(
      profileFor(fixture),
      () => Promise.resolve(undefined),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(cancelled.stop()).resolves.toBeUndefined();
  });

  it("contains stderr and cleans up a process that fails before it spawns", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-session-"));
    roots.push(root);
    const fixture = join(root, "stderr.mjs");
    await writeFile(
      fixture,
      `import { createInterface } from "node:readline";
process.stderr.write("diagnostic");
createInterface({ input: process.stdin }).on("line", () => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } }) + "\\n"));`,
    );
    const healthy = await startMcpSession(profileFor(fixture), () =>
      Promise.resolve(undefined),
    );
    await expect(healthy.probe()).resolves.toEqual({
      capabilities: {},
      protocolVersion: undefined,
    });
    await healthy.stop();

    await expect(
      startMcpSession(
        {
          ...profileFor(fixture),
          local: {
            argv: [join(root, "does-not-exist")],
            secretReferences: {},
          },
        },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toThrow("could not start");
  });
});

function profileFor(
  fixture: string,
  secretReferences: Record<string, string> = {},
  arguments_: string[] = [],
) {
  return {
    metadata: {
      protocolVersion: "1" as const,
      id: "fixture",
      version: "1.0.0",
      contentHash: "a".repeat(64),
      label: "Fixture",
      capabilities: [],
      tools: [],
    },
    local: {
      argv: [process.execPath, fixture, ...arguments_] as [string, ...string[]],
      secretReferences,
    },
  };
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

function socketRequest(socketPath: string, line: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const socket = createConnection(socketPath, () =>
      socket.write(`${line}\n`),
    );
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      settled = true;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)) as unknown);
    });
    socket.on("error", reject);
    socket.on("close", () => {
      if (!settled) reject(new Error("Socket closed without a response."));
    });
  });
}
