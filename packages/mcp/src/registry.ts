import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { McpProfile, McpProfileInput, McpProfileMetadata } from "./types";

const PROFILE_PATH = ["mcp-profiles.json"];
const IDENTIFIER = /^[a-z][a-z0-9-]*$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ENVIRONMENT_KEY = /^[A-Z_][A-Z0-9_]*$/u;
const RESERVED_ENVIRONMENT_KEYS = new Set([
  "HOME",
  "CODEX_HOME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
]);

/**
 * Stores operator-installed profiles beneath a runner-owned root. Metadata is
 * suitable for display; executable paths and secret references remain local.
 */
export class McpProfileRegistry {
  readonly #path: string;
  #mutation: Promise<void> = Promise.resolve();
  #temporarySequence = 0;

  constructor(root: string) {
    this.#path = join(root, ...PROFILE_PATH);
  }

  async add(profile: McpProfileInput): Promise<void> {
    await this.#mutate(async () => {
      const normalized = withContentHash(profile);
      assertNoImportedSecretReferences(normalized);
      const profiles = await this.#read();
      if (
        profiles.some(({ metadata }) => metadata.id === normalized.metadata.id)
      ) {
        throw new Error(
          `MCP profile '${normalized.metadata.id}' is already installed.`,
        );
      }
      profiles.push(normalized);
      await this.#write(profiles);
    });
  }

  async remove(id: string): Promise<void> {
    await this.#mutate(async () => {
      const profiles = await this.#read();
      const retained = profiles.filter(({ metadata }) => metadata.id !== id);
      if (retained.length === profiles.length) {
        throw new Error(`MCP profile '${id}' is not installed.`);
      }
      await this.#write(retained);
    });
  }

  async grant(
    id: string,
    serverEnvironmentName: string,
    runnerEnvironmentName: string,
  ): Promise<void> {
    await this.#mutate(async () => {
      assertServerEnvironmentName(serverEnvironmentName);
      assertRunnerEnvironmentName(runnerEnvironmentName);
      const profiles = await this.#read();
      const profile = profiles.find(({ metadata }) => metadata.id === id);
      if (profile === undefined) {
        throw new Error(`MCP profile '${id}' is not installed.`);
      }
      profile.local.secretReferences[serverEnvironmentName] =
        runnerEnvironmentName;
      profile.metadata.contentHash = mcpProfileContentHash(profile);
      await this.#write(profiles);
    });
  }

  async revoke(id: string, serverEnvironmentName: string): Promise<void> {
    await this.#mutate(async () => {
      assertServerEnvironmentName(serverEnvironmentName);
      const profiles = await this.#read();
      const profile = profiles.find(({ metadata }) => metadata.id === id);
      if (profile === undefined) {
        throw new Error(`MCP profile '${id}' is not installed.`);
      }
      delete profile.local.secretReferences[serverEnvironmentName];
      profile.metadata.contentHash = mcpProfileContentHash(profile);
      await this.#write(profiles);
    });
  }

  async list(): Promise<McpProfileMetadata[]> {
    return (await this.#read()).map(({ metadata }) =>
      structuredClone(metadata),
    );
  }

  async get(id: string): Promise<McpProfile> {
    const profile = (await this.#read()).find(
      ({ metadata }) => metadata.id === id,
    );
    if (profile === undefined) {
      throw new Error(`MCP profile '${id}' is not installed.`);
    }
    return cloneProfile(profile);
  }

  async #read(): Promise<McpProfile[]> {
    try {
      const contents = await readFile(this.#path, "utf8");
      const profiles: unknown = JSON.parse(contents);
      if (!Array.isArray(profiles))
        throw new Error("MCP profile registry is invalid.");
      for (const profile of profiles as unknown[]) {
        if (!isRecord(profile)) {
          throw new Error("MCP profile registry is invalid.");
        }
        validateProfile(profile);
        if (profile.metadata.contentHash !== mcpProfileContentHash(profile)) {
          throw new Error("MCP profile registry is invalid.");
        }
      }
      return profiles.map((profile) => cloneProfile(profile as McpProfile));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #write(profiles: McpProfile[]): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.${(this.#temporarySequence += 1)}.tmp`;
    await writeFile(temporary, JSON.stringify(profiles), {
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

/** Stable identity for the complete runner-local profile, excluding its hash. */
export function mcpProfileContentHash(
  profile: McpProfileInput | McpProfile,
): string {
  const { metadata, local } = profile;
  return createHash("sha256")
    .update(
      JSON.stringify({
        metadata: {
          protocolVersion: metadata.protocolVersion,
          id: metadata.id,
          version: metadata.version,
          label: metadata.label,
          ...(metadata.description === undefined
            ? {}
            : { description: metadata.description }),
          capabilities: metadata.capabilities,
          tools: metadata.tools,
        },
        local: {
          argv: local.argv,
          ...(local.cwd === undefined ? {} : { cwd: local.cwd }),
          secretReferences: local.secretReferences,
        },
      }),
    )
    .digest("hex");
}

function withContentHash(profile: McpProfileInput): McpProfile {
  if (
    !isRecord(profile) ||
    !isRecord(profile.metadata) ||
    !isRecord(profile.local)
  ) {
    throw new Error("MCP profile is invalid.");
  }
  const normalized: McpProfile = {
    metadata: {
      ...structuredClone(profile.metadata),
      contentHash: "0".repeat(64),
    },
    local: structuredClone(profile.local),
  };
  validateProfile(normalized as unknown as Record<string, unknown>);
  normalized.metadata.contentHash = mcpProfileContentHash(normalized);
  return normalized;
}

function assertNoImportedSecretReferences(profile: McpProfileInput): void {
  if (Object.keys(profile.local.secretReferences).length > 0) {
    throw new Error(
      "MCP profile imports must not declare secret references. Use an explicit local grant.",
    );
  }
}

function assertServerEnvironmentName(value: string): void {
  if (!ENVIRONMENT_KEY.test(value) || RESERVED_ENVIRONMENT_KEYS.has(value)) {
    throw new Error("MCP secret grant names are invalid.");
  }
}

function assertRunnerEnvironmentName(value: string): void {
  if (!ENVIRONMENT_KEY.test(value)) {
    throw new Error("MCP secret grant names are invalid.");
  }
}

function validateProfile(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & McpProfile {
  const metadata = value.metadata;
  const local = value.local;
  if (
    !isRecord(metadata) ||
    metadata.protocolVersion !== "1" ||
    typeof metadata.id !== "string" ||
    !IDENTIFIER.test(metadata.id) ||
    typeof metadata.version !== "string" ||
    !VERSION.test(metadata.version) ||
    typeof metadata.contentHash !== "string" ||
    !SHA256.test(metadata.contentHash) ||
    typeof metadata.label !== "string" ||
    metadata.label.length === 0 ||
    !Array.isArray(metadata.capabilities) ||
    metadata.capabilities.some(
      (capability) => typeof capability !== "string",
    ) ||
    !Array.isArray(metadata.tools) ||
    metadata.tools.some((tool) => typeof tool !== "string") ||
    (metadata.description !== undefined &&
      typeof metadata.description !== "string") ||
    !isRecord(local) ||
    !Array.isArray(local.argv) ||
    local.argv.length === 0 ||
    local.argv.some(
      (argument) => typeof argument !== "string" || argument.length === 0,
    ) ||
    (local.cwd !== undefined && typeof local.cwd !== "string") ||
    !isRecord(local.secretReferences) ||
    Object.entries(local.secretReferences).some(
      ([key, reference]) =>
        !ENVIRONMENT_KEY.test(key) ||
        RESERVED_ENVIRONMENT_KEYS.has(key) ||
        typeof reference !== "string" ||
        reference.length === 0,
    )
  ) {
    throw new Error("MCP profile is invalid.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneProfile(profile: McpProfile): McpProfile {
  return structuredClone(profile);
}
