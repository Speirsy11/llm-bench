import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { McpProfileRegistry, verifyMcpProfileArtifacts } from "./index";

const CONTENT_HASH = "a".repeat(64);

describe("McpProfileRegistry", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("requires a separate local grant before associating a runner environment secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    const server = join(root, "server.mjs");
    await writeFile(server, "process.stdin.resume();");

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
        argv: [process.execPath, server] as [string, string],
        cwd: root,
        secretReferences: {},
      },
    };
    await registry.add(profile);
    const beforeGrant = (await registry.list())[0]?.contentHash;
    await registry.grant("filesystem", "GITHUB_TOKEN", "RUNNER_GITHUB_TOKEN");

    const listed = await registry.list();
    expect(listed[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(listed).toMatchObject([
      {
        protocolVersion: "1",
        id: "filesystem",
        version: "1.2.3",
        label: "Filesystem",
        description: "Local filesystem tools",
        capabilities: ["tools"],
        tools: ["read_file"],
      },
    ]);
    await expect(registry.get("filesystem")).resolves.toMatchObject({
      local: { secretReferences: { GITHUB_TOKEN: "RUNNER_GITHUB_TOKEN" } },
    });
    expect((await registry.list())[0]?.contentHash).not.toBe(beforeGrant);

    const path = join(root, "mcp-profiles.json");
    await expect(readFile(path, "utf8")).resolves.toContain(
      "RUNNER_GITHUB_TOKEN",
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(path, "utf8")) as [
      { local: { secretReferences: Record<string, string> } },
    ];
    stored[0].local.secretReferences.GITHUB_TOKEN = "TAMPERED_TOKEN";
    await writeFile(path, JSON.stringify(stored));
    await expect(registry.list()).rejects.toThrow("registry is invalid");
  });

  it("rejects imported secret references and validates serialized grant mutations", async () => {
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

    await expect(
      registry.add({
        ...profile,
        local: { ...profile.local, secretReferences: { MCP_TOKEN: "TOKEN" } },
      }),
    ).rejects.toThrow("secret references");
    await registry.add(profile);
    await expect(
      registry.grant("fixture", "lower", "RUNNER_TOKEN"),
    ).rejects.toThrow("invalid");
    await expect(
      registry.grant("fixture", "MCP_TOKEN", "lower"),
    ).rejects.toThrow("invalid");
    await expect(
      registry.grant("fixture", "HOME", "RUNNER_TOKEN"),
    ).rejects.toThrow("invalid");
    await expect(
      registry.grant("missing", "MCP_TOKEN", "RUNNER_TOKEN"),
    ).rejects.toThrow("not installed");
    await expect(registry.revoke("missing", "MCP_TOKEN")).rejects.toThrow(
      "not installed",
    );
    await Promise.all([
      registry.grant("fixture", "MCP_TOKEN", "RUNNER_TOKEN"),
      registry.grant("fixture", "SECOND_TOKEN", "RUNNER_SECOND_TOKEN"),
    ]);
    await registry.revoke("fixture", "MCP_TOKEN");

    await expect(registry.get("fixture")).resolves.toMatchObject({
      local: { secretReferences: { SECOND_TOKEN: "RUNNER_SECOND_TOKEN" } },
    });
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
    const listed = await registry.list();
    expect(listed[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    const { contentHash: _operatorHash, ...expectedMetadata } =
      profile.metadata;
    expect(listed).toMatchObject([expectedMetadata]);
  });

  it("uses canonical artifact SemVer for profile versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const registry = new McpProfileRegistry(root);
    const profile = {
      metadata: {
        protocolVersion: "1" as const,
        id: "canonical",
        version: "1.2.3-alpha.1+build.5",
        label: "Canonical",
        capabilities: [],
        tools: [],
      },
      local: { argv: [process.execPath] as [string], secretReferences: {} },
    };

    await registry.add(profile);
    await expect(registry.list()).resolves.toMatchObject([
      { version: "1.2.3-alpha.1+build.5" },
    ]);
    for (const [index, version] of [
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-01",
    ].entries()) {
      await expect(
        registry.add({
          ...profile,
          metadata: {
            ...profile.metadata,
            id: `invalid-version-${String(index)}`,
            version,
          },
        }),
      ).rejects.toThrow("invalid");
    }
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

  it("attests executable scripts and rejects replacement before launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-mcp-"));
    roots.push(root);
    const script = join(root, "server.mjs");
    await writeFile(script, "process.stdin.resume();");
    const registry = new McpProfileRegistry(root);
    const profile = {
      metadata: {
        protocolVersion: "1" as const,
        id: "attested",
        version: "1.0.0",
        label: "Attested",
        capabilities: [],
        tools: [],
      },
      local: {
        argv: [process.execPath, script] as [string, string],
        secretReferences: {},
      },
    };

    await registry.add(profile);
    const installed = await registry.get("attested");
    expect(installed.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    await writeFile(script, "process.exit(1);");
    await expect(registry.get("attested")).rejects.toThrow(
      "execution artifacts changed",
    );
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "missing-script" },
        local: {
          ...profile.local,
          argv: [process.execPath, join(root, "missing.mjs")],
        },
      }),
    ).rejects.toThrow("cannot be attested");
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "interpreter-option" },
        local: {
          ...profile.local,
          argv: [process.execPath, "--eval", "process.stdin.resume()"],
        },
      }),
    ).rejects.toThrow("interpreter option");
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "env-wrapper" },
        local: {
          ...profile.local,
          argv: ["/usr/bin/env", "node", script],
        },
      }),
    ).rejects.toThrow("unsupported wrapper");
    const envAlias = join(root, "apparently-native");
    await symlink("/usr/bin/env", envAlias);
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "aliased-env-wrapper" },
        local: {
          ...profile.local,
          argv: [envAlias, "-Snode", script],
        },
      }),
    ).rejects.toThrow("unsupported wrapper");
    for (const runtime of ["bun", "deno"]) {
      const executable = join(root, runtime);
      await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      await expect(
        registry.add({
          ...profile,
          metadata: { ...profile.metadata, id: `${runtime}-runtime` },
          local: { ...profile.local, argv: [executable, script] },
        }),
      ).rejects.toThrow("unsupported interpreter");
    }
    const ambiguous = join(root, "custom-runtime");
    await writeFile(ambiguous, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "ambiguous-runtime" },
        local: { ...profile.local, argv: [ambiguous, script] },
      }),
    ).rejects.toThrow("ambiguous positional");

    const relativeScript = join(root, "relative.mjs");
    await writeFile(relativeScript, "process.stdin.resume();");
    await registry.add({
      ...profile,
      metadata: { ...profile.metadata, id: "relative-script" },
      local: {
        ...profile.local,
        argv: [process.execPath, "relative.mjs"],
        cwd: root,
      },
    });
    await expect(registry.get("relative-script")).resolves.toBeDefined();
    await registry.add({
      ...profile,
      metadata: { ...profile.metadata, id: "process-relative-script" },
      local: {
        ...profile.local,
        argv: [process.execPath, relative(process.cwd(), relativeScript)],
      },
    });
    await expect(
      registry.get("process-relative-script"),
    ).resolves.toBeDefined();
    await expect(
      registry.add({
        ...profile,
        metadata: { ...profile.metadata, id: "directory-command" },
        local: { ...profile.local, argv: [root] },
      }),
    ).rejects.toThrow("cannot be attested");

    await expect(
      verifyMcpProfileArtifacts({
        metadata: {
          protocolVersion: "1",
          id: "unverifiable",
          version: "1.0.0",
          contentHash: "0".repeat(64),
          label: "Unverifiable",
          capabilities: [],
          tools: [],
        },
        local: { argv: [process.execPath], secretReferences: {} },
      }),
    ).rejects.toThrow("unverifiable execution artifacts");

    const deletedScript = join(root, "deleted.mjs");
    await writeFile(deletedScript, "process.stdin.resume();");
    await registry.add({
      ...profile,
      metadata: { ...profile.metadata, id: "deleted-script" },
      local: { ...profile.local, argv: [process.execPath, deletedScript] },
    });
    await unlink(deletedScript);
    await expect(registry.get("deleted-script")).rejects.toThrow(
      "execution artifacts changed",
    );

    const firstTarget = join(root, "first-target.mjs");
    const secondTarget = join(root, "second-target.mjs");
    const linkedScript = join(root, "linked-server.mjs");
    await writeFile(firstTarget, "process.stdin.resume();");
    await writeFile(secondTarget, "process.stdin.resume();");
    await symlink(firstTarget, linkedScript);
    await registry.add({
      ...profile,
      metadata: { ...profile.metadata, id: "symlinked" },
      local: { ...profile.local, argv: [process.execPath, linkedScript] },
    });
    await unlink(linkedScript);
    await symlink(secondTarget, linkedScript);
    await expect(registry.get("symlinked")).rejects.toThrow(
      "execution artifacts changed",
    );
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
