const modelRouteCatalog = {
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

export function selectedDashboardModelRoutes(routeIds: readonly string[]) {
  return routeIds
    .filter(
      (id): id is keyof typeof modelRouteCatalog => id in modelRouteCatalog,
    )
    .map((id) => modelRouteCatalog[id]);
}

export function defaultDashboardMatrix() {
  const modelRoutes = Object.values(modelRouteCatalog);
  return {
    modelRoutes,
    harnesses: [
      {
        id: "llmbench",
        version: "1.0.0",
        capabilities: ["workspaces", "files"] as ("workspaces" | "files")[],
        modelRoutes,
      },
    ],
    toolsets: [
      {
        id: "builtin",
        version: "1.0.0",
        tools: [],
        mcpProfiles: [],
      },
    ],
  };
}
