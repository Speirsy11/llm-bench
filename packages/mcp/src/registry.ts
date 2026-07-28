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
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { McpProfile, McpProfileInput, McpProfileMetadata } from "./types";

const PROFILE_PATH = ["mcp-profiles.json"];
const IDENTIFIER = /^[a-z][a-z0-9-]*$/u;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
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
const WRAPPER_EXECUTABLES = new Set([
  "corepack",
  "env",
  "npm",
  "npx",
  "pnpm",
  "uv",
  "uvx",
  "xargs",
  "yarn",
]);
const UNSUPPORTED_INTERPRETERS = new Set([
  "bun",
  "deno",
  "java",
  "perl",
  "php",
  "ruby",
]);

export interface VerifiedMcpLaunch {
  argv: [string, ...string[]];
  cwd?: string;
}

interface AttestedExecution {
  artifacts: { path: string; contentHash: string }[];
  launch: VerifiedMcpLaunch;
}

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
      const normalized = await withContentHash(profile);
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
    await verifyMcpProfileArtifacts(profile);
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
export function mcpProfileContentHash(profile: McpProfile): string {
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
          artifactAttestations: local.artifactAttestations,
        },
      }),
    )
    .digest("hex");
}

async function withContentHash(profile: McpProfileInput): Promise<McpProfile> {
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
    local: {
      ...structuredClone(profile.local),
      artifactAttestations: [
        { path: "pending-attestation", contentHash: "0".repeat(64) },
      ],
    },
  };
  validateProfile(normalized as unknown as Record<string, unknown>);
  normalized.local.artifactAttestations = (
    await attestExecutionArtifacts(profile)
  ).artifacts;
  normalized.metadata.contentHash = mcpProfileContentHash(normalized);
  return normalized;
}

async function attestExecutionArtifacts(
  profile: McpProfileInput,
): Promise<AttestedExecution> {
  const [command, firstArgument] = profile.local.argv;
  const commandPath = await attestedFile(command, true);
  const commandName = basename(commandPath).toLowerCase();
  if (WRAPPER_EXECUTABLES.has(commandName)) {
    throw new Error(
      "MCP profile execution cannot be attested through an unsupported wrapper.",
    );
  }
  if (UNSUPPORTED_INTERPRETERS.has(commandName)) {
    throw new Error("MCP profile execution uses an unsupported interpreter.");
  }
  const paths = [commandPath];
  const launchArguments = profile.local.argv.slice(1);
  if (firstArgument !== undefined && isScriptRuntime(commandPath)) {
    if (firstArgument.startsWith("-")) {
      throw new Error(
        "MCP profile execution cannot be attested when an interpreter option precedes its script.",
      );
    }
    const scriptPath = isAbsolute(firstArgument)
      ? firstArgument
      : resolve(profile.local.cwd ?? process.cwd(), firstArgument);
    const resolvedScript = await attestedFile(scriptPath, false);
    paths.push(resolvedScript);
    launchArguments[0] = resolvedScript;
  } else if (
    firstArgument !== undefined &&
    profile.local.argv.slice(1).some((argument) => !argument.startsWith("-"))
  ) {
    throw new Error(
      "MCP profile execution has ambiguous positional executable inputs.",
    );
  }
  const artifacts = await Promise.all(
    paths.map(async (path) => ({
      path,
      contentHash: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
  return {
    artifacts,
    launch: {
      argv: [commandPath, ...launchArguments],
      ...(profile.local.cwd === undefined ? {} : { cwd: profile.local.cwd }),
    },
  };
}

async function attestedFile(
  path: string,
  executable: boolean,
): Promise<string> {
  try {
    const resolved = await realpath(path);
    const details = await stat(resolved);
    if (!details.isFile()) throw new Error("not a file");
    if (executable) await access(resolved, constants.X_OK);
    return resolved;
  } catch {
    throw new Error(`MCP execution artifact '${path}' cannot be attested.`);
  }
}

function isScriptRuntime(command: string): boolean {
  return /^(?:node|python(?:3(?:\.\d+)?)?|bash|sh)$/u.test(basename(command));
}

export async function verifyMcpProfileArtifacts(
  profile: McpProfile,
): Promise<VerifiedMcpLaunch> {
  const attestations = profile.local.artifactAttestations;
  if (attestations === undefined || attestations.length === 0) {
    throw new Error(
      `MCP profile '${profile.metadata.id}' has unverifiable execution artifacts. Reinstall it.`,
    );
  }
  let current: AttestedExecution;
  try {
    current = await attestExecutionArtifacts(profile);
  } catch {
    throw artifactChanged(profile.metadata.id);
  }
  if (
    current.artifacts.length !== attestations.length ||
    current.artifacts.some(
      (artifact, index) =>
        artifact.path !== attestations[index]?.path ||
        artifact.contentHash !== attestations[index].contentHash,
    )
  ) {
    throw artifactChanged(profile.metadata.id);
  }
  return current.launch;
}

function artifactChanged(id: string): Error {
  return new Error(
    `MCP profile '${id}' execution artifacts changed after installation. Reinstall it.`,
  );
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
    !Array.isArray(local.artifactAttestations) ||
    local.artifactAttestations.length === 0 ||
    local.artifactAttestations.some(
      (artifact) =>
        !isRecord(artifact) ||
        typeof artifact.path !== "string" ||
        artifact.path.length === 0 ||
        typeof artifact.contentHash !== "string" ||
        !SHA256.test(artifact.contentHash),
    ) ||
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
