import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PluginManifest } from "@speirsy11/llm-bench-harness-sdk";

import type { HarnessManifest } from "@llm-bench/contracts";
import { HarnessManifestSchema } from "@llm-bench/contracts";

const CREDENTIAL_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const PROTOCOL_VERSION = /^(\d+)\.\d+\.\d+$/u;
const REGISTRY_PATH = ["plugins.json"];
const RESERVED_HARNESS_IDS = new Set(["llmbench", "codex", "claude", "pi"]);

export interface PluginProbeResult {
  protocolVersion: string;
  manifest: PluginManifest;
}

export interface PluginRegistryOptions {
  probe: (argv: readonly [string, ...string[]]) => Promise<PluginProbeResult>;
}

export interface PluginInstallRequest {
  executable: string;
  credentialGrants?: Record<string, string>;
}

export interface PluginInventoryEntry {
  protocolVersion: string;
  contentHash: string;
  manifest: HarnessManifest;
}

export interface PluginExecution extends PluginInventoryEntry {
  argv: [string, ...string[]];
  credentialGrants: Record<string, string>;
}

interface StoredPlugin extends PluginInventoryEntry {
  local: {
    executable: string;
    credentialGrants: Record<string, string>;
  };
}

/**
 * Runner-owned storage for explicit executable plugin installations. Its public
 * inventory deliberately excludes paths, arguments, and credential mappings.
 */
export class PluginRegistry {
  readonly #path: string;
  #mutation: Promise<void> = Promise.resolve();
  #temporarySequence = 0;

  constructor(
    root: string,
    private readonly options: PluginRegistryOptions,
  ) {
    this.#path = join(root, ...REGISTRY_PATH);
  }

  async install(request: PluginInstallRequest): Promise<PluginInventoryEntry> {
    return this.#mutate(async () => {
      if (typeof request.executable !== "string" || "argv" in request) {
        throw new Error(
          "Plugin installation requires one self-contained executable artifact.",
        );
      }
      const executable = await verifiedExecutable(request.executable);
      const probe = await this.options.probe([executable]);
      assertProtocolVersion(probe.protocolVersion);
      const manifest = coreManifest(probe.manifest);
      const credentialGrants = grants(request.credentialGrants ?? {});
      const stored = await this.#read();
      if (stored.some((plugin) => plugin.manifest.id === manifest.id)) {
        throw new Error(`Plugin '${manifest.id}' is already installed.`);
      }
      const inventory: PluginInventoryEntry = {
        protocolVersion: probe.protocolVersion,
        contentHash: await contentHash(executable),
        manifest,
      };
      stored.push({
        ...inventory,
        local: { executable, credentialGrants },
      });
      await this.#write(stored);
      return cloneInventory(inventory);
    });
  }

  async remove(id: string): Promise<void> {
    await this.#mutate(async () => {
      const stored = await this.#read();
      const retained = stored.filter((plugin) => plugin.manifest.id !== id);
      if (retained.length === stored.length) throw missingPlugin(id);
      await this.#write(retained);
    });
  }

  async list(): Promise<PluginInventoryEntry[]> {
    return (await this.#read()).map(cloneInventory);
  }

  async grant(
    id: string,
    pluginCredentialName: string,
    runnerCredentialName: string,
  ): Promise<void> {
    await this.#mutate(async () => {
      assertCredentialName(pluginCredentialName);
      assertCredentialName(runnerCredentialName);
      const stored = await this.#read();
      const plugin = stored.find((entry) => entry.manifest.id === id);
      if (plugin === undefined) throw missingPlugin(id);
      plugin.local.credentialGrants[pluginCredentialName] =
        runnerCredentialName;
      await this.#write(stored);
    });
  }

  async revoke(id: string, pluginCredentialName: string): Promise<void> {
    await this.#mutate(async () => {
      assertCredentialName(pluginCredentialName);
      const stored = await this.#read();
      const plugin = stored.find((entry) => entry.manifest.id === id);
      if (plugin === undefined) throw missingPlugin(id);
      delete plugin.local.credentialGrants[pluginCredentialName];
      await this.#write(stored);
    });
  }

  async resolveExecution(id: string): Promise<PluginExecution> {
    const plugin = (await this.#read()).find(
      (entry) => entry.manifest.id === id,
    );
    if (plugin === undefined) throw missingPlugin(id);
    const executable = await verifiedExecutable(plugin.local.executable);
    const actualContentHash = await contentHash(executable);
    if (actualContentHash !== plugin.contentHash) {
      throw new Error(
        `Plugin '${id}' executable changed after installation. Reinstall the plugin before running it.`,
      );
    }
    return {
      ...cloneInventory(plugin),
      argv: [executable],
      credentialGrants: structuredClone(plugin.local.credentialGrants),
    };
  }

  async #read(): Promise<StoredPlugin[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!Array.isArray(value)) throw new Error("Plugin registry is invalid.");
      return value.map(parseStoredPlugin);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #write(stored: StoredPlugin[]): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${this.#path}.${process.pid}.${(this.#temporarySequence += 1)}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutation.then(operation, operation);
    this.#mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function verifiedExecutable(path: string): Promise<string> {
  let executable: string;
  try {
    executable = await realpath(path);
    const details = await stat(executable);
    if (!details.isFile()) throw new Error("not a file");
    await access(executable, constants.X_OK);
  } catch {
    throw new Error(`Plugin executable '${path}' must be an executable file.`);
  }
  return executable;
}

async function contentHash(executable: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
}

function coreManifest(manifest: PluginManifest): HarnessManifest {
  const projected = HarnessManifestSchema.parse({
    id: manifest.id,
    version: manifest.version,
    capabilities: manifest.capabilities,
    modelRoutes: manifest.modelRoutes,
  });
  if (RESERVED_HARNESS_IDS.has(projected.id)) {
    throw new Error(
      `Plugin id '${projected.id}' is a reserved built-in harness id.`,
    );
  }
  return projected;
}

function assertProtocolVersion(version: string): void {
  const match = PROTOCOL_VERSION.exec(version);
  if (match?.[1] !== "1") {
    throw new Error(
      `Plugin protocol '${version}' is unsupported. Update or reinstall the plugin for protocol major 1.`,
    );
  }
}

function grants(value: Record<string, string>): Record<string, string> {
  for (const [pluginName, runnerName] of Object.entries(value)) {
    assertCredentialName(pluginName);
    assertCredentialName(runnerName);
  }
  return structuredClone(value);
}

function assertCredentialName(value: string): void {
  if (!CREDENTIAL_NAME.test(value)) {
    throw new Error(
      "Plugin credential grants must contain credential names only.",
    );
  }
}

function parseStoredPlugin(value: unknown): StoredPlugin {
  if (!isRecord(value)) {
    throw new Error("Plugin registry is invalid.");
  }
  const candidate = value;
  const local = candidate.local;
  if (
    typeof candidate.protocolVersion !== "string" ||
    typeof candidate.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(candidate.contentHash) ||
    !isRecord(local) ||
    typeof local.executable !== "string" ||
    local.executable.length === 0 ||
    "argv" in local ||
    !isRecord(local.credentialGrants) ||
    Object.values(local.credentialGrants).some(
      (runnerName) => typeof runnerName !== "string",
    )
  ) {
    throw new Error("Plugin registry is invalid.");
  }
  assertProtocolVersion(candidate.protocolVersion);
  const manifest = HarnessManifestSchema.parse(candidate.manifest);
  const credentialGrants = grants(
    Object.fromEntries(Object.entries(local.credentialGrants)) as Record<
      string,
      string
    >,
  );
  return {
    protocolVersion: candidate.protocolVersion,
    contentHash: candidate.contentHash,
    manifest,
    local: {
      executable: local.executable,
      credentialGrants,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneInventory(plugin: PluginInventoryEntry): PluginInventoryEntry {
  return structuredClone({
    protocolVersion: plugin.protocolVersion,
    contentHash: plugin.contentHash,
    manifest: plugin.manifest,
  });
}

function missingPlugin(id: string): Error {
  return new Error(`Plugin '${id}' is not installed.`);
}
