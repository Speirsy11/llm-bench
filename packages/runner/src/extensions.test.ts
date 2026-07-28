import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunnerExtensionManager } from "./extensions";

describe("RunnerExtensionManager", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("combines sanitized plugin and MCP inventory and bounds operational probes", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-extensions-"));
    roots.push(root);
    const executable = join(root, "plugin.mjs");
    const profilePath = join(root, "mcp.json");
    await writeFile(executable, "#!/usr/bin/env node\n", { mode: 0o700 });
    await chmod(executable, 0o700);
    await writeFile(
      profilePath,
      JSON.stringify({
        metadata: {
          protocolVersion: "1",
          id: "filesystem",
          version: "1.0.0",
          label: "Filesystem",
          capabilities: ["tools"],
          tools: ["read_file"],
        },
        local: {
          argv: [executable],
          secretReferences: {},
        },
      }),
    );
    let probes = 0;
    let stops = 0;
    const manager = new RunnerExtensionManager(root, {
      pluginProbe: () =>
        Promise.resolve({
          protocolVersion: "1.0.0",
          manifest: {
            id: "fixture-plugin",
            name: "Fixture",
            version: "1.0.0",
            capabilities: ["response_generation"],
            modelRoutes: [
              { id: "fixture", provider: "local", model: "fixture" },
            ],
          },
        }),
      resolveMcpSecret: (name) =>
        Promise.resolve(name === "MCP_RUNNER_TOKEN" ? "secret" : undefined),
      startMcp: async (_profile, resolveSecret) => {
        await expect(resolveSecret("MCP_RUNNER_TOKEN")).resolves.toBe("secret");
        return Promise.resolve({
          probe: () => {
            probes += 1;
            return Promise.resolve({ capabilities: { tools: {} } });
          },
          stop: () => {
            stops += 1;
            return Promise.resolve();
          },
        });
      },
    });

    await manager.plugin.add(executable);
    await expect(manager.plugin.probe([executable])).resolves.toMatchObject({
      manifest: { id: "fixture-plugin" },
    });
    await manager.plugin.grant(
      "fixture-plugin",
      "PLUGIN_TOKEN",
      "RUNNER_TOKEN",
    );
    await manager.plugin.revoke("fixture-plugin", "PLUGIN_TOKEN");
    await expect(manager.plugin.list()).resolves.toHaveLength(1);
    await manager.mcp.add(profilePath);
    await manager.mcp.grant("filesystem", "MCP_TOKEN", "MCP_RUNNER_TOKEN");
    await expect(manager.mcp.list()).resolves.toHaveLength(1);
    const inventory = await manager.inventory();
    expect(inventory).toMatchObject({
      plugins: [{ manifest: { id: "fixture-plugin" } }],
      mcpProfiles: [
        {
          id: "filesystem",
          version: "1.0.0",
          tools: ["read_file"],
        },
      ],
    });
    expect(inventory.mcpProfiles[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(inventory)).not.toContain("/opt/mcp");
    expect(JSON.stringify(inventory)).not.toContain("MCP_RUNNER_TOKEN");
    await expect(manager.mcp.probe("filesystem")).resolves.toEqual({
      capabilities: { tools: {} },
    });
    await manager.mcp.stop("filesystem");
    expect(manager.pluginRegistry).toBeDefined();
    expect(manager.mcpRegistry).toBeDefined();
    expect({ probes, stops }).toEqual({ probes: 1, stops: 1 });
    await manager.plugin.remove("fixture-plugin");
    await manager.mcp.remove("filesystem");
  });

  it("uses the real isolated probe and MCP session defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-extensions-"));
    roots.push(root);
    const plugin = join(root, "plugin.mjs");
    const server = join(root, "mcp.mjs");
    const profilePath = join(root, "mcp.json");
    await writeFile(
      plugin,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).once("line", () => {
  process.stdout.write(JSON.stringify({ kind: "handshake_reply", protocolVersion: "1.0.0", manifest: { id: "real-plugin", name: "Real", version: "1.0.0", capabilities: [], modelRoutes: [] } }) + "\\n");
});`,
      { mode: 0o700 },
    );
    await chmod(plugin, 0o700);
    await writeFile(
      server,
      `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).once("line", (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { canary: process.env.MCP_TOKEN } } } }) + "\\n");
});`,
    );
    await writeFile(
      profilePath,
      JSON.stringify({
        metadata: {
          protocolVersion: "1",
          id: "real-mcp",
          version: "1.0.0",
          label: "Real MCP",
          capabilities: ["tools"],
          tools: [],
        },
        local: {
          argv: [process.execPath, server],
          secretReferences: {},
        },
      }),
    );
    const manager = new RunnerExtensionManager(root);

    await expect(manager.plugin.probe([plugin])).resolves.toMatchObject({
      manifest: { id: "real-plugin" },
    });
    await manager.mcp.add(profilePath);
    vi.stubEnv("LLMBENCH_TEST_MCP_TOKEN", "runner-local-secret");
    await manager.mcp.grant("real-mcp", "MCP_TOKEN", "LLMBENCH_TEST_MCP_TOKEN");
    const result = await manager.mcp.probe("real-mcp");
    expect(JSON.stringify(result)).not.toContain("runner-local-secret");
    expect(result).toEqual({
      capabilities: { tools: { canary: "[REDACTED]" } },
      protocolVersion: "2025-06-18",
    });
    await manager.mcp.revoke("real-mcp", "MCP_TOKEN");
  });
});
