import { describe, expect, it } from "vitest";

import { dashboardMatrixForHarness, defaultDashboardMatrix } from "./matrix";

describe("defaultDashboardMatrix", () => {
  it("offers the bounded repository tools required by the LLMBench repair target", () => {
    const matrix = defaultDashboardMatrix();
    expect(matrix.harnesses[0]?.capabilities).toEqual([
      "response_generation",
      "workspaces",
      "files",
    ]);
    expect(matrix.toolsets).toEqual([
      {
        id: "builtin",
        version: "1.0.0",
        tools: ["read_file", "list_directory", "search_files", "apply_patch"],
        mcpProfiles: [],
      },
    ]);
  });

  it.each([
    ["codex", "codex-gpt-5.4", "gpt-5.4"],
    ["claude", "claude-sonnet-4-6", "claude-sonnet-4-6"],
    ["pi", "pi-gpt-5.4", "gpt-5.4"],
  ])("offers %s through native authentication", (harnessId, routeId, model) => {
    const matrix = dashboardMatrixForHarness(harnessId);

    expect(matrix).toMatchObject({
      modelRoutes: [{ id: routeId, provider: harnessId, model }],
      harnesses: [
        {
          id: harnessId,
          version: "1.0.0",
          modelRoutes: [{ id: routeId }],
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
    });
  });

  it("labels Pi as response-only through its advertised capabilities", () => {
    expect(dashboardMatrixForHarness("pi").harnesses[0]?.capabilities).toEqual([
      "response_generation",
      "streaming",
      "usage_reporting",
    ]);
  });

  it("builds an external plugin matrix only from its runner advertisement", () => {
    const matrix = dashboardMatrixForHarness(
      "example-repair",
      {
        plugins: [
          {
            protocolVersion: "1.0.0",
            contentHash: "a".repeat(64),
            manifest: {
              id: "example-repair",
              version: "2.0.0",
              capabilities: ["workspaces", "files", "mcp"],
              modelRoutes: [
                {
                  id: "example-local",
                  provider: "example",
                  model: "deterministic",
                },
              ],
            },
          },
        ],
        mcpProfiles: [
          {
            id: "github",
            version: "1.0.0",
            contentHash: "b".repeat(64),
            tools: ["issues_list"],
          },
        ],
      },
      ["github"],
    );

    expect(matrix).toMatchObject({
      modelRoutes: [{ id: "example-local" }],
      harnesses: [{ id: "example-repair", version: "2.0.0" }],
      toolsets: [
        {
          id: "plugin-example-repair",
          tools: ["read_file", "list_directory", "search_files", "apply_patch"],
          mcpProfiles: [
            { id: "github", version: "1.0.0", contentHash: "b".repeat(64) },
          ],
        },
      ],
    });
  });
});
