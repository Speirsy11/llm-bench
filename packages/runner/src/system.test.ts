import { describe, expect, it } from "vitest";

import { probeRunnerSystem } from "./system";

describe("probeRunnerSystem", () => {
  it("reports capabilities without hostname, username, or absolute paths", () => {
    const probe = probeRunnerSystem();
    const serialized = JSON.stringify(probe);

    expect(probe.capabilities).toEqual(["workspaces", "files"]);
    expect(serialized).not.toMatch(/hostname|username|homeDirectory|cwd/);
    expect(probe.environment.runtimeVersions.node).toMatch(/^\d+\./);
  });

  it("reports unsupported systems and handles missing CPU metadata", () => {
    const probe = probeRunnerSystem({
      platform: () => "win32",
      nodeVersion: "21.0.0",
      architecture: () => "x64",
      cpuModels: () => [],
      totalMemory: () => 1024 * 1024 * 1024,
    });

    expect(probe.issues).toEqual([
      "Unsupported operating system: win32.",
      "Node 22 is required; detected 21.0.0.",
    ]);
    expect(probe.environment).toMatchObject({
      os: "linux",
      cpuClass: "unknown",
      memoryMb: 1024,
    });
  });

  it("accepts the supported Node 22 macOS combination", () => {
    expect(
      probeRunnerSystem({
        platform: () => "darwin",
        nodeVersion: "22.21.0",
        architecture: () => "arm64",
        cpuModels: () => ["Apple M4"],
        totalMemory: () => 8 * 1024 * 1024 * 1024,
      }),
    ).toMatchObject({ issues: [], environment: { os: "darwin" } });
  });

  it("handles a missing node major segment", () => {
    expect(
      probeRunnerSystem({
        platform: () => "linux",
        nodeVersion: "",
        architecture: () => "x64",
        cpuModels: () => ["cpu"],
        totalMemory: () => 1024,
      }).issues,
    ).toEqual(["Node 22 is required; detected ."]);
  });
});
