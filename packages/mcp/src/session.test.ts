import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { startMcpSession } from "./index";

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
