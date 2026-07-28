import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mcpProfileContentHash, McpProfileRegistry } from "./index";

const CONTENT_HASH = "a".repeat(64);

describe("McpProfileRegistry", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("persists sanitized metadata separately from runner-local executable and secret references", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);

    const profile = {
      metadata: {
        protocolVersion: "1" as const,
        id: "filesystem",
        version: "1.2.3",
        contentHash: CONTENT_HASH,
        label: "Filesystem",
        description: "Local filesystem tools",
        capabilities: ["tools"],
        tools: ["read_file"],
      },
      local: {
        argv: [process.execPath, "server.mjs"] as [string, string],
        cwd: "/opt/mcp",
        secretReferences: { GITHUB_TOKEN: "keychain:github" },
      },
    };
    await registry.add(profile);

    await expect(registry.list()).resolves.toEqual([
      {
        protocolVersion: "1",
        id: "filesystem",
        version: "1.2.3",
        contentHash: mcpProfileContentHash(profile),
        label: "Filesystem",
        description: "Local filesystem tools",
        capabilities: ["tools"],
        tools: ["read_file"],
      },
    ]);
    await expect(registry.get("filesystem")).resolves.toMatchObject({
      local: { secretReferences: { GITHUB_TOKEN: "keychain:github" } },
    });

    const path = join(root, "mcp-profiles.json");
    await expect(readFile(path, "utf8")).resolves.toContain("keychain:github");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects duplicate ids and malformed versions without replacing the installed profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    const profile = {
      metadata: {
        protocolVersion: "1" as const,
        id: "fixture",
        version: "1.0.0",
        contentHash: CONTENT_HASH,
        label: "Fixture",
        capabilities: [],
        tools: [],
      },
      local: { argv: [process.execPath] as [string], secretReferences: {} },
    };

    await registry.add(profile);
    await expect(registry.add(profile)).rejects.toThrow("already installed");
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "invalid", version: "v1" },
      }),
    ).rejects.toThrow("invalid");
    await expect(registry.list()).resolves.toEqual([
      {
        ...profile.metadata,
        contentHash: mcpProfileContentHash(profile),
      },
    ]);
  });

  it("removes a profile and reports a missing id", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    await registry.add({
      metadata: {
        protocolVersion: "1",
        id: "fixture",
        version: "1.0.0",
        contentHash: CONTENT_HASH,
        label: "Fixture",
        capabilities: [],
        tools: [],
      },
      local: { argv: [process.execPath], secretReferences: {} },
    });

    await registry.remove("fixture");
    await expect(registry.list()).resolves.toEqual([]);
    await expect(registry.get("fixture")).rejects.toThrow("not installed");
    await expect(registry.remove("fixture")).rejects.toThrow("not installed");
  });

  it("rejects malformed persisted entries and every unsafe local profile field", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    await writeFile(join(root, "mcp-profiles.json"), "[null]");
    await expect(registry.list()).rejects.toThrow("registry is invalid");
    await writeFile(join(root, "mcp-profiles.json"), "{}");
    await expect(registry.list()).rejects.toThrow("registry is invalid");
    await writeFile(join(root, "mcp-profiles.json"), "not-json");
    await expect(registry.list()).rejects.toThrow();

    const valid = {
      metadata: {
        protocolVersion: "1" as const,
        id: "fixture",
        version: "1.0.0",
        contentHash: CONTENT_HASH,
        label: "Fixture",
        capabilities: [],
        tools: [],
      },
      local: { argv: [process.execPath] as [string], secretReferences: {} },
    };
    const invalids: unknown[] = [
      null,
      { ...valid, metadata: null },
      { ...valid, metadata: { ...valid.metadata, id: "invalid_id" } },
      { ...valid, metadata: { ...valid.metadata, label: "" } },
      { ...valid, metadata: { ...valid.metadata, capabilities: [1] } },
      { ...valid, metadata: { ...valid.metadata, tools: [1] } },
      { ...valid, metadata: { ...valid.metadata, description: 1 } },
      { ...valid, local: null },
      { ...valid, local: { ...valid.local, argv: [] } },
      { ...valid, local: { ...valid.local, argv: [""] } },
      { ...valid, local: { ...valid.local, cwd: 1 } },
      { ...valid, local: { ...valid.local, secretReferences: null } },
      {
        ...valid,
        local: {
          ...valid.local,
          secretReferences: { lower: "keychain:token" },
        },
      },
      { ...valid, local: { ...valid.local, secretReferences: { TOKEN: "" } } },
      {
        ...valid,
        local: {
          ...valid.local,
          secretReferences: { HOME: "RUNNER_HOME_SECRET" },
        },
      },
    ];
    for (const invalid of invalids) {
      await expect(registry.add(invalid as never)).rejects.toThrow("invalid");
    }
  });

  it("computes inventory-safe content hashes and detects persisted tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    const profile = {
      metadata: {
        protocolVersion: "1" as const,
        id: "filesystem",
        version: "1.0.0",
        contentHash: "operator-input-is-not-trusted",
        label: "Filesystem",
        capabilities: ["tools"],
        tools: ["read_file"],
      },
      local: { argv: [process.execPath] as [string], secretReferences: {} },
    };

    await registry.add(profile);
    const installed = await registry.list();
    expect(installed).toHaveLength(1);
    expect(installed[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const path = join(root, "mcp-profiles.json");
    const stored = JSON.parse(await readFile(path, "utf8")) as [
      { metadata: { tools: string[] } },
    ];
    stored[0].metadata.tools.push("tampered");
    await writeFile(path, JSON.stringify(stored));
    await expect(registry.list()).rejects.toThrow("registry is invalid");
  });

  it("serializes concurrent mutations without losing a profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    const profile = (id: string) => ({
      metadata: {
        protocolVersion: "1" as const,
        id,
        version: "1.0.0",
        contentHash: CONTENT_HASH,
        label: id,
        capabilities: [],
        tools: [],
      },
      local: { argv: [process.execPath] as [string], secretReferences: {} },
    });

    await Promise.all([
      registry.add(profile("first")),
      registry.add(profile("second")),
    ]);

    await expect(registry.list()).resolves.toHaveLength(2);
  });
});
