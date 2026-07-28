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

  it("rejects unsupported agentic harnesses", () => {
    expect(() => dashboardMatrixForHarness("pi")).toThrow(
      "Unsupported dashboard harness: pi.",
    );
  });
});
