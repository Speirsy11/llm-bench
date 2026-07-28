import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "@speirsy11/llm-bench-harness-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { PluginRegistry } from "./plugin-registry";

describe("PluginRegistry", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("installs a locally executable plugin and exposes only sanitized inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    const executable = join(root, "fixture-plugin.mjs");
    await writeFile(executable, "#!/usr/bin/env node\nprocess.exit(0);\n", {
      mode: 0o700,
    });
    await chmod(executable, 0o700);
    const registry = new PluginRegistry(root, {
      probe: () =>
        Promise.resolve({
          protocolVersion: "1.0.0",
          manifest: {
            id: "fixture-plugin",
            name: "Fixture plugin",
            version: "1.2.3",
            capabilities: ["response_generation"],
            modelRoutes: [
              { id: "fixture", provider: "local", model: "fixture-model" },
            ],
          },
        }),
    });

    await registry.install({
      argv: [executable, "--jsonl"],
      credentialGrants: { PLUGIN_TOKEN: "RUNNER_FIXTURE_TOKEN" },
    });

    await expect(registry.list()).resolves.toEqual([
      {
        protocolVersion: "1.0.0",
        contentHash:
          "bfa9f984d632a8a4380c43ed277839a1b600c0266af0a3a27d4c6abd48881475",
        manifest: {
          id: "fixture-plugin",
          version: "1.2.3",
          capabilities: ["response_generation"],
          modelRoutes: [
            { id: "fixture", provider: "local", model: "fixture-model" },
          ],
        },
      },
    ]);
    const persisted = await readFile(join(root, "plugins.json"), "utf8");
    expect(persisted).toContain("RUNNER_FIXTURE_TOKEN");
    expect((await stat(join(root, "plugins.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(await registry.list())).not.toContain(executable);
    expect(JSON.stringify(await registry.list())).not.toContain(
      "RUNNER_FIXTURE_TOKEN",
    );
  });

  it("rejects directories, non-executables, duplicate ids, and unsupported protocol majors", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    const directory = join(root, "plugin-directory");
    const nonExecutable = join(root, "not-executable.mjs");
    await mkdir(directory);
    await writeFile(nonExecutable, "process.exit(0);", { mode: 0o600 });
    const registry = new PluginRegistry(root, {
      probe: () =>
        Promise.resolve({
          protocolVersion: "2.0.0",
          manifest: fixtureManifest("fixture-plugin"),
        }),
    });

    await expect(registry.install({ argv: [directory] })).rejects.toThrow(
      "executable file",
    );
    await expect(registry.install({ argv: [nonExecutable] })).rejects.toThrow(
      "executable file",
    );
    const executable = await executableFixture(root, "fixture-plugin.mjs");
    await expect(registry.install({ argv: [executable] })).rejects.toThrow(
      "unsupported",
    );

    const installed = new PluginRegistry(root, {
      probe: () =>
        Promise.resolve({
          protocolVersion: "1.0.0",
          manifest: fixtureManifest("fixture-plugin"),
        }),
    });
    await installed.install({ argv: [executable] });
    await expect(installed.install({ argv: [executable] })).rejects.toThrow(
      "already installed",
    );

    const reserved = new PluginRegistry(root, {
      probe: () =>
        Promise.resolve({
          protocolVersion: "1.0.0",
          manifest: fixtureManifest("llmbench"),
        }),
    });
    await expect(
      reserved.install({
        argv: [await executableFixture(root, "reserved.mjs")],
      }),
    ).rejects.toThrow("reserved built-in harness");
  });

  it("keeps credential grants as names, supports revocation, and removes installations", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    const executable = await executableFixture(root, "fixture-plugin.mjs");
    const registry = registryFor(root);
    await registry.install({ argv: [executable] });

    await registry.grant("fixture-plugin", "PLUGIN_TOKEN", "RUNNER_TOKEN");
    await expect(
      registry.resolveExecution("fixture-plugin"),
    ).resolves.toMatchObject({
      credentialGrants: { PLUGIN_TOKEN: "RUNNER_TOKEN" },
    });
    await expect(
      registry.grant("fixture-plugin", "not-a-name", "TOKEN"),
    ).rejects.toThrow("names only");
    await expect(
      registry.grant("missing", "PLUGIN_TOKEN", "RUNNER_TOKEN"),
    ).rejects.toThrow("not installed");
    await registry.revoke("fixture-plugin", "PLUGIN_TOKEN");
    await expect(
      registry.resolveExecution("fixture-plugin"),
    ).resolves.toMatchObject({
      credentialGrants: {},
    });
    await registry.remove("fixture-plugin");
    await expect(registry.list()).resolves.toEqual([]);
    await expect(registry.remove("fixture-plugin")).rejects.toThrow(
      "not installed",
    );
    await expect(
      registry.revoke("fixture-plugin", "PLUGIN_TOKEN"),
    ).rejects.toThrow("not installed");
    await expect(registry.resolveExecution("fixture-plugin")).rejects.toThrow(
      "not installed",
    );
  });

  it("refuses execution when the locally installed executable changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    const executable = await executableFixture(root, "fixture-plugin.mjs");
    const registry = registryFor(root);
    await registry.install({ argv: [executable] });
    await writeFile(executable, "#!/usr/bin/env node\nprocess.exit(1);\n", {
      mode: 0o700,
    });
    await chmod(executable, 0o700);

    await expect(registry.resolveExecution("fixture-plugin")).rejects.toThrow(
      "changed after installation",
    );
  });

  it("serializes concurrent registry mutations within one runner process", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    const first = await executableFixture(root, "first.mjs");
    const second = await executableFixture(root, "second.mjs");
    const registry = new PluginRegistry(root, {
      probe: (argv) =>
        Promise.resolve({
          protocolVersion: "1.0.0",
          manifest: fixtureManifest(
            argv[0].includes("first") ? "first" : "second",
          ),
        }),
    });

    await Promise.all([
      registry.install({ argv: [first] }),
      registry.install({ argv: [second] }),
    ]);
    await expect(registry.list()).resolves.toHaveLength(2);
  });

  it("fails closed when persisted local configuration is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-plugin-registry-"));
    roots.push(root);
    await writeFile(join(root, "plugins.json"), "[null]");
    const registry = registryFor(root);

    await expect(registry.list()).rejects.toThrow("registry is invalid");
    await writeFile(join(root, "plugins.json"), "[{}]");
    await expect(registry.list()).rejects.toThrow("registry is invalid");
    await writeFile(join(root, "plugins.json"), "{}");
    await expect(registry.list()).rejects.toThrow("registry is invalid");
  });
});

function registryFor(root: string): PluginRegistry {
  return new PluginRegistry(root, {
    probe: () =>
      Promise.resolve({
        protocolVersion: "1.0.0",
        manifest: fixtureManifest("fixture-plugin"),
      }),
  });
}

function fixtureManifest(id: string): PluginManifest {
  return {
    id,
    name: "Fixture plugin",
    version: "1.2.3",
    capabilities: ["response_generation"],
    modelRoutes: [{ id: "fixture", provider: "local", model: "fixture-model" }],
  };
}

async function executableFixture(root: string, name: string): Promise<string> {
  const executable = join(root, name);
  await writeFile(executable, "#!/usr/bin/env node\nprocess.exit(0);\n", {
    mode: 0o700,
  });
  await chmod(executable, 0o700);
  return executable;
}
