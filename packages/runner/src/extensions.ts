import { readFile } from "node:fs/promises";

import type { RunnerInventory } from "@llm-bench/contracts";
import type {
  McpProfile,
  McpProfileInput,
  McpSessionOptions,
  SecretResolver,
} from "@llm-bench/mcp";
import { McpProfileRegistry, startMcpSession } from "@llm-bench/mcp";

import type { RunnerExtensionOperations } from "./cli-app";
import type { PluginProbeResult } from "./plugin-registry";
import { probeExecutablePlugin } from "./plugin-probe";
import { PluginRegistry } from "./plugin-registry";

interface ExtensionSession {
  probe(signal?: AbortSignal): Promise<unknown>;
  stop(): Promise<void>;
}

interface RunnerExtensionManagerOptions {
  pluginProbe?: (
    argv: readonly [string, ...string[]],
  ) => Promise<PluginProbeResult>;
  resolveMcpSecret?: SecretResolver;
  startMcp?: (
    profile: McpProfile,
    resolveSecret: SecretResolver,
    options?: McpSessionOptions,
  ) => Promise<ExtensionSession>;
}

/** Coordinates runner-local extension registries and bounded MCP probes. */
export class RunnerExtensionManager implements RunnerExtensionOperations {
  readonly #plugins: PluginRegistry;
  readonly #mcpProfiles: McpProfileRegistry;

  constructor(
    root: string,
    private readonly options: RunnerExtensionManagerOptions = {},
  ) {
    this.#plugins = new PluginRegistry(root, {
      probe: options.pluginProbe ?? probeExecutablePlugin,
    });
    this.#mcpProfiles = new McpProfileRegistry(root);
  }

  readonly plugin: RunnerExtensionOperations["plugin"] = {
    add: (argv) => this.#plugins.install({ argv }),
    remove: (id) => this.#plugins.remove(id),
    list: () => this.#plugins.list(),
    probe: (argv) => (this.options.pluginProbe ?? probeExecutablePlugin)(argv),
    grant: (id, pluginName, runnerName) =>
      this.#plugins.grant(id, pluginName, runnerName),
    revoke: (id, pluginName) => this.#plugins.revoke(id, pluginName),
  };

  readonly mcp: RunnerExtensionOperations["mcp"] = {
    add: async (profilePath) => {
      const value: unknown = JSON.parse(await readFile(profilePath, "utf8"));
      await this.#mcpProfiles.add(value as McpProfileInput);
    },
    remove: (id) => this.#mcpProfiles.remove(id),
    list: () => this.#mcpProfiles.list(),
    probe: async (id) => {
      const profile = await this.#mcpProfiles.get(id);
      const session = await (this.options.startMcp ?? startMcpSession)(
        profile,
        this.options.resolveMcpSecret ??
          ((name) => Promise.resolve(process.env[name])),
      );
      try {
        return await session.probe();
      } finally {
        await session.stop();
      }
    },
    // MCP sessions are deliberately job/probe scoped, so there is no
    // persistent daemon for a later CLI process to kill.
    stop: () => Promise.resolve(),
  };

  async inventory(): Promise<RunnerInventory> {
    const [plugins, profiles] = await Promise.all([
      this.#plugins.list(),
      this.#mcpProfiles.list(),
    ]);
    return {
      plugins,
      mcpProfiles: profiles.map((profile) => ({
        id: profile.id,
        version: profile.version,
        contentHash: profile.contentHash,
        tools: [...profile.tools],
      })),
    };
  }

  get pluginRegistry(): PluginRegistry {
    return this.#plugins;
  }

  get mcpRegistry(): McpProfileRegistry {
    return this.#mcpProfiles;
  }
}
