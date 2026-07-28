import { describe, expect, it } from "vitest";

import type { RunnerExecution, RunnerInventory } from "./runner-protocol";
import {
  LLMBENCH_REPOSITORY_TOOLS,
  nativeHarnessCliBlocker,
  REPOSITORY_REPAIR_REQUIRED_CAPABILITIES,
  targetCompatibilityBlockers,
} from "./target-compatibility";

const required = REPOSITORY_REPAIR_REQUIRED_CAPABILITIES;
const tools = LLMBENCH_REPOSITORY_TOOLS;
const filesystemProfile = {
  id: "filesystem",
  version: "1.0.0",
  contentHash:
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

function target(harnessId = "llmbench"): RunnerExecution["target"] {
  const modelRoute = {
    id: "openrouter-gpt-4o",
    provider: "openrouter",
    model: "gpt-4o",
  };
  return {
    modelRoute,
    harness: {
      id: harnessId,
      version: "1.0.0",
      capabilities: [...required],
      modelRoutes: [{ ...modelRoute }],
    },
    toolset: {
      id: harnessId === "llmbench" ? "builtin" : "native",
      version: "1.0.0",
      tools: harnessId === "llmbench" ? [...tools] : [],
      mcpProfiles: [],
    },
  };
}

describe("targetCompatibilityBlockers", () => {
  it("accepts exact LLMBench and native target contracts", () => {
    expect(targetCompatibilityBlockers(target(), required, tools)).toEqual([]);
    expect(
      targetCompatibilityBlockers(target("codex"), required, tools, {
        codex: "0.142.1",
      }),
    ).toEqual([]);
  });

  it("blocks native harnesses missing a compatible runner CLI version", () => {
    expect(nativeHarnessCliBlocker("llmbench", {})).toBeNull();
    expect(
      targetCompatibilityBlockers(target("codex"), required, tools, {}),
    ).toEqual(["Runner does not advertise an installed codex CLI."]);
    expect(
      targetCompatibilityBlockers(target("claude"), required, tools, {
        claude: "unknown",
      }),
    ).toEqual([
      "Runner advertises an incompatible claude CLI version: unknown.",
    ]);
    expect(
      targetCompatibilityBlockers(target("pi"), required, tools, {}),
    ).toEqual(["Runner does not advertise an installed pi CLI."]);
    expect(nativeHarnessCliBlocker("pi", { pi: "0.55.2" })).toBeNull();
  });

  it("rejects an unknown harness before durable execution", () => {
    expect(
      targetCompatibilityBlockers(target("unknown"), required, tools),
    ).toEqual(["Harness unknown is unsupported."]);
  });

  it("accepts only the exact locally advertised plugin and MCP identities", () => {
    const pluginTarget = target("example-repair");
    pluginTarget.harness.capabilities.push("mcp");
    pluginTarget.toolset = {
      id: "plugin-tools",
      version: "1.0.0",
      tools: ["read_file"],
      mcpProfiles: [filesystemProfile],
    };
    pluginTarget.plugin = {
      protocolVersion: "1.0.0",
      contentHash: "b".repeat(64),
    };
    const inventory: RunnerInventory = {
      plugins: [
        {
          protocolVersion: pluginTarget.plugin.protocolVersion,
          contentHash: pluginTarget.plugin.contentHash,
          manifest: structuredClone(pluginTarget.harness),
        },
      ],
      mcpProfiles: [
        {
          ...filesystemProfile,
          tools: ["read_file"],
        },
      ],
    };

    expect(
      targetCompatibilityBlockers(pluginTarget, required, tools, {}, inventory),
    ).toEqual([]);

    inventory.plugins[0]?.manifest.capabilities.reverse();
    inventory.plugins[0]?.manifest.modelRoutes.reverse();
    expect(
      targetCompatibilityBlockers(pluginTarget, required, tools, {}, inventory),
    ).toEqual([]);

    pluginTarget.plugin.contentHash = "c".repeat(64);
    expect(
      targetCompatibilityBlockers(pluginTarget, required, tools, {}, inventory),
    ).toEqual([
      "Plugin example-repair is not installed with protocol 1.0.0 and the selected content hash.",
    ]);

    pluginTarget.plugin.contentHash = inventory.plugins[0]?.contentHash ?? "";
    pluginTarget.toolset.mcpProfiles[0] = {
      ...filesystemProfile,
      contentHash: "d".repeat(64),
    };
    expect(
      targetCompatibilityBlockers(pluginTarget, required, tools, {}, inventory),
    ).toEqual([
      "MCP profile filesystem 1.0.0 is not installed with the selected content hash.",
    ]);
  });

  it("reports route, capability, tool, and MCP mismatches", () => {
    const incompatible = target();
    incompatible.harness.modelRoutes[0] = {
      ...incompatible.modelRoute,
      model: "different",
    };
    incompatible.harness.capabilities = ["workspaces"];
    incompatible.toolset.tools = ["read_file"];
    incompatible.toolset.mcpProfiles = [filesystemProfile];

    expect(targetCompatibilityBlockers(incompatible, required, tools)).toEqual([
      "Selected model route openrouter-gpt-4o is not declared by harness llmbench.",
      "Harness llmbench lacks required capability response_generation.",
      "Harness llmbench lacks required capability files.",
      "LLMBench repository repair requires builtin toolset 1.0.0 with tools: read_file, list_directory, search_files, apply_patch.",
      "Harness llmbench does not support runner-managed MCP profiles.",
    ]);

    const native = target("claude");
    native.toolset.tools = ["read_file"];
    native.toolset.mcpProfiles = [filesystemProfile];
    expect(targetCompatibilityBlockers(native, required, tools)).toEqual([
      "Harness claude uses native tools and cannot receive runner-managed tools.",
      "Harness claude does not support runner-managed MCP profiles.",
    ]);
  });

  it("rejects a harness-declared LLMBench route for an unsupported provider", () => {
    const unsupported = target();
    unsupported.modelRoute.provider = "direct";
    unsupported.harness.modelRoutes[0] = { ...unsupported.modelRoute };

    expect(targetCompatibilityBlockers(unsupported, required, tools)).toEqual([
      "LLMBench requires an OpenRouter model route.",
    ]);
  });

  it("rejects stale harness/toolset identities, versions, and duplicate tools", () => {
    const llmbench = target();
    llmbench.harness.version = "2.0.0";
    llmbench.toolset.id = "custom";
    llmbench.toolset.version = "2.0.0";
    llmbench.toolset.tools.push("apply_patch");
    expect(targetCompatibilityBlockers(llmbench, required, tools)).toEqual([
      "Harness llmbench version 2.0.0 is unsupported; expected 1.0.0.",
      "LLMBench repository repair requires builtin toolset 1.0.0 with tools: read_file, list_directory, search_files, apply_patch.",
    ]);

    const native = target("codex");
    native.harness.version = "2.0.0";
    native.toolset.id = "builtin";
    native.toolset.version = "2.0.0";
    expect(targetCompatibilityBlockers(native, required, tools)).toEqual([
      "Harness codex version 2.0.0 is unsupported; expected 1.0.0.",
      "Harness codex requires native toolset 1.0.0.",
    ]);
  });
});
