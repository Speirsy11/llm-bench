import { describe, expect, it } from "vitest";

import type { RunnerExecution, RunnerInventory } from "@llm-bench/contracts";

import { executionTargetForRunner } from "./dashboard-experiments";

const target: RunnerExecution["target"] = {
  harness: {
    id: "example-repair",
    version: "1.0.0",
    capabilities: ["response_generation", "workspaces", "files"],
    modelRoutes: [
      { id: "example-local", provider: "example", model: "deterministic" },
    ],
  },
  modelRoute: {
    id: "example-local",
    provider: "example",
    model: "deterministic",
  },
  toolset: {
    id: "plugin",
    version: "1.0.0",
    tools: ["read_file", "apply_patch"],
    mcpProfiles: [],
  },
};

describe("executionTargetForRunner", () => {
  it("pins an advertised external harness to its immutable plugin identity", () => {
    const inventory: RunnerInventory = {
      plugins: [
        {
          protocolVersion: "1.0.0",
          contentHash: "a".repeat(64),
          manifest: structuredClone(target.harness),
        },
      ],
      mcpProfiles: [],
    };

    expect(executionTargetForRunner(target, inventory)).toEqual({
      ...target,
      plugin: {
        protocolVersion: "1.0.0",
        contentHash: "a".repeat(64),
      },
    });
    expect(target).not.toHaveProperty("plugin");
  });

  it("does not reinterpret built-in or unadvertised harnesses as plugins", () => {
    const inventory: RunnerInventory = {
      plugins: [
        {
          protocolVersion: "1.0.0",
          contentHash: "b".repeat(64),
          manifest: {
            ...structuredClone(target.harness),
            id: "llmbench",
          },
        },
      ],
      mcpProfiles: [],
    };

    expect(executionTargetForRunner(target, inventory)).toEqual(target);
    expect(
      executionTargetForRunner(
        {
          ...target,
          harness: { ...target.harness, id: "llmbench" },
        },
        inventory,
      ),
    ).not.toHaveProperty("plugin");
  });
});
