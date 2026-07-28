import type {
  Capability,
  HarnessManifest,
  ModelRoute,
  RunnerInventory,
  Toolset,
} from "@llm-bench/contracts";

const openRouterRouteCatalog = {
  "openrouter-gpt-4o": {
    id: "openrouter-gpt-4o",
    provider: "openrouter",
    model: "openai/gpt-4o",
  },
  "openrouter-llama": {
    id: "openrouter-llama",
    provider: "openrouter",
    model: "meta-llama/llama-3.1-70b-instruct",
  },
} satisfies Record<string, { id: string; provider: string; model: string }>;

export const DASHBOARD_HARNESS_IDS = [
  "llmbench",
  "codex",
  "claude",
  "pi",
] as const;

export type DashboardHarnessId = string;

export function selectedDashboardModelRoutes(routeIds: readonly string[]) {
  return routeIds
    .filter(
      (id): id is keyof typeof openRouterRouteCatalog =>
        id in openRouterRouteCatalog,
    )
    .map((id) => openRouterRouteCatalog[id]);
}

export function defaultDashboardMatrix(): DashboardMatrix {
  return dashboardMatrixForHarness("llmbench");
}

export function dashboardMatrixForHarness(
  harnessId: string,
  inventory: RunnerInventory = { plugins: [], mcpProfiles: [] },
  selectedMcpProfileIds: readonly string[] = [],
): DashboardMatrix {
  switch (harnessId) {
    case "llmbench": {
      const modelRoutes = Object.values(openRouterRouteCatalog);
      return {
        modelRoutes,
        harnesses: [
          {
            id: "llmbench",
            version: "1.0.0",
            capabilities: [
              "response_generation",
              "workspaces",
              "files",
            ] satisfies Capability[],
            modelRoutes,
          },
        ],
        toolsets: [
          {
            id: "builtin",
            version: "1.0.0",
            tools: [
              "read_file",
              "list_directory",
              "search_files",
              "apply_patch",
            ],
            mcpProfiles: [],
          },
        ],
      };
    }
    case "codex":
      return nativeMatrix({
        id: "codex",
        route: {
          id: "codex-gpt-5.4",
          provider: "codex",
          model: "gpt-5.4",
        },
      });
    case "claude":
      return nativeMatrix({
        id: "claude",
        route: {
          id: "claude-sonnet-4-6",
          provider: "claude",
          model: "claude-sonnet-4-6",
        },
      });
    case "pi":
      return nativeMatrix({
        id: "pi",
        route: {
          id: "pi-gpt-5.4",
          provider: "pi",
          model: "gpt-5.4",
        },
      });
    default:
      return pluginMatrix(harnessId, inventory, selectedMcpProfileIds);
  }
}

const repositoryTools = [
  "read_file",
  "list_directory",
  "search_files",
  "apply_patch",
];

function pluginMatrix(
  harnessId: string,
  inventory: RunnerInventory,
  selectedMcpProfileIds: readonly string[],
): DashboardMatrix {
  const plugin = inventory.plugins.find(
    ({ manifest }) => manifest.id === harnessId,
  );
  if (plugin === undefined) {
    throw new Error(`Unsupported dashboard harness: ${harnessId}.`);
  }
  const supportsMcp = plugin.manifest.capabilities.includes("mcp");
  if (!supportsMcp && selectedMcpProfileIds.length > 0) {
    throw new Error(`Harness does not advertise MCP support: ${harnessId}.`);
  }
  const selectedMcpProfiles = supportsMcp
    ? [...new Set(selectedMcpProfileIds)].map((id) => {
        const profile = inventory.mcpProfiles.find((item) => item.id === id);
        if (profile === undefined) {
          throw new Error(`Unknown MCP profile for runner: ${id}.`);
        }
        return {
          id: profile.id,
          version: profile.version,
          contentHash: profile.contentHash,
        };
      })
    : [];
  return {
    modelRoutes: plugin.manifest.modelRoutes,
    harnesses: [plugin.manifest],
    toolsets: [
      {
        id: `plugin-${plugin.manifest.id}`,
        version: plugin.manifest.version,
        tools: repositoryTools,
        mcpProfiles: selectedMcpProfiles,
      },
    ],
  };
}

function nativeMatrix({
  id,
  route,
}: {
  readonly id: "codex" | "claude" | "pi";
  readonly route: ModelRoute;
}): DashboardMatrix {
  return {
    modelRoutes: [route],
    harnesses: [
      {
        id,
        version: "1.0.0",
        capabilities:
          id === "pi"
            ? ([
                "response_generation",
                "streaming",
                "usage_reporting",
              ] satisfies Capability[])
            : ([
                "response_generation",
                "workspaces",
                "files",
                "session_resume",
              ] satisfies Capability[]),
        modelRoutes: [route],
      },
    ],
    toolsets: [
      {
        id: "native",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [],
      },
    ],
  };
}

interface DashboardMatrix {
  readonly modelRoutes: ModelRoute[];
  readonly harnesses: HarnessManifest[];
  readonly toolsets: Toolset[];
}
