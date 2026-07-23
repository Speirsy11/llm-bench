/* eslint-disable turbo/no-undeclared-env-vars -- the public runtime probe intentionally discovers CLIs through PATH */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { probeRunnerSystem } from "./system";

describe("probeRunnerSystem", () => {
  it("reports capabilities without hostname, username, or absolute paths", () => {
    const probe = probeRunnerSystem();
    const serialized = JSON.stringify(probe);

    expect(probe.capabilities).toEqual([
      "response_generation",
      "workspaces",
      "files",
    ]);
    expect(serialized).not.toMatch(/hostname|username|homeDirectory|cwd/);
    expect(probe.environment.runtimeVersions.node).toMatch(/^\d+\./);
  });

  it("advertises only detected native CLI versions", () => {
    const probe = probeRunnerSystem({
      platform: () => "linux",
      nodeVersion: "22.21.0",
      pythonVersion: () => "3.13.5",
      harnessVersions: () => ({ codex: "0.142.1", claude: "2.1.198" }),
      architecture: () => "x64",
      cpuModels: () => ["cpu"],
      totalMemory: () => 1024,
    });

    expect(probe.environment.harnessVersions).toEqual({
      llmbench: "1.0.0",
      codex: "0.142.1",
      claude: "2.1.198",
    });
  });

  it("detects installed native CLIs and omits failed or unparseable probes", async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), "llmbench-clis-"));
    const codex = join(fixtureDirectory, "codex");
    const claude = join(fixtureDirectory, "claude");
    const originalPath = process.env.PATH;

    try {
      await writeFile(codex, "#!/bin/sh\necho 'codex-cli 0.142.1'\n");
      await writeFile(claude, "#!/bin/sh\necho '2.1.198 (Claude Code)'\n");
      await Promise.all([chmod(codex, 0o755), chmod(claude, 0o755)]);
      process.env.PATH = `${fixtureDirectory}:${originalPath ?? ""}`;

      expect(probeRunnerSystem().environment.harnessVersions).toMatchObject({
        codex: "0.142.1",
        claude: "2.1.198",
      });

      await writeFile(codex, "#!/bin/sh\nexit 1\n");
      await writeFile(claude, "#!/bin/sh\necho 'unparseable'\n");
      expect(probeRunnerSystem().environment.harnessVersions).toEqual({
        llmbench: "1.0.0",
      });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("reports unsupported systems and handles missing CPU metadata", () => {
    const probe = probeRunnerSystem({
      platform: () => "win32",
      nodeVersion: "21.0.0",
      pythonVersion: () => null,
      architecture: () => "x64",
      cpuModels: () => [],
      totalMemory: () => 1024 * 1024 * 1024,
    });

    expect(probe.issues).toEqual([
      "Unsupported operating system: win32.",
      "Node 22 or newer is required; detected 21.0.0.",
      "Python 3 is required but was not found.",
    ]);
    expect(probe.environment).toMatchObject({
      os: "linux",
      cpuClass: "unknown",
      memoryMb: 1024,
    });
  });

  it("accepts supported Node 22+ macOS combinations", () => {
    expect(
      probeRunnerSystem({
        platform: () => "darwin",
        nodeVersion: "22.21.0",
        pythonVersion: () => "3.13.5",
        architecture: () => "arm64",
        cpuModels: () => ["Apple M4"],
        totalMemory: () => 8 * 1024 * 1024 * 1024,
      }),
    ).toMatchObject({ issues: [], environment: { os: "darwin" } });
    expect(
      probeRunnerSystem({
        platform: () => "darwin",
        nodeVersion: "24.0.0",
        pythonVersion: () => "3.13.5",
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
        pythonVersion: () => "3.13.5",
        architecture: () => "x64",
        cpuModels: () => ["cpu"],
        totalMemory: () => 1024,
      }).issues,
    ).toEqual(["Node 22 or newer is required; detected ."]);
  });

  it.each(["2.7.18", "3.10.14", "3", "unparseable"])(
    "rejects unsupported Python version %s",
    (pythonVersion) => {
      expect(
        probeRunnerSystem({
          platform: () => "linux",
          nodeVersion: "22.21.0",
          pythonVersion: () => pythonVersion,
          architecture: () => "x64",
          cpuModels: () => ["cpu"],
          totalMemory: () => 1024,
        }).issues,
      ).toEqual([
        `Python 3.11 or newer is required; detected ${pythonVersion}.`,
      ]);
    },
  );

  it("accepts the minimum supported Python version", () => {
    expect(
      probeRunnerSystem({
        platform: () => "linux",
        nodeVersion: "22.21.0",
        pythonVersion: () => "3.11.0",
        architecture: () => "x64",
        cpuModels: () => ["cpu"],
        totalMemory: () => 1024,
      }).issues,
    ).toEqual([]);
  });

  it("fails closed when automatic Python detection cannot execute or parse", () => {
    const original = process.env.LLMBENCH_PYTHON;
    try {
      process.env.LLMBENCH_PYTHON = "/definitely/missing/python";
      expect(probeRunnerSystem().issues).toContain(
        "Python 3 is required but was not found.",
      );
      process.env.LLMBENCH_PYTHON = "/usr/bin/false";
      expect(probeRunnerSystem().issues).toContain(
        "Python 3 is required but was not found.",
      );
      process.env.LLMBENCH_PYTHON = "/usr/bin/true";
      expect(probeRunnerSystem().issues).toContain(
        "Python 3 is required but was not found.",
      );
    } finally {
      if (original === undefined) delete process.env.LLMBENCH_PYTHON;
      else process.env.LLMBENCH_PYTHON = original;
    }
  });
});
