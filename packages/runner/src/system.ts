import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { arch, cpus, platform, totalmem } from "node:os";

import { REPOSITORY_REPAIR_REQUIRED_CAPABILITIES } from "@llm-bench/contracts";

import type { CapabilityProbe } from "./cli-app";

interface SystemFacts {
  platform(): NodeJS.Platform;
  nodeVersion: string;
  pythonVersion(): string | null;
  harnessVersions?(): Record<string, string>;
  architecture(): string;
  cpuModels(): string[];
  totalMemory(): number;
}

export function probeRunnerSystem(
  facts: SystemFacts = {
    platform,
    nodeVersion: process.versions.node,
    pythonVersion: detectPythonVersion,
    harnessVersions: detectNativeHarnessVersions,
    architecture: arch,
    cpuModels: () => cpus().map(({ model }) => model),
    totalMemory: totalmem,
  },
): CapabilityProbe {
  const os = facts.platform();
  const nodeVersion = facts.nodeVersion;
  const issues: string[] = [];
  if (os !== "darwin" && os !== "linux") {
    issues.push(`Unsupported operating system: ${os}.`);
  }
  const nodeMajor = Number.parseInt(nodeVersion, 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    issues.push(`Node 22 or newer is required; detected ${nodeVersion}.`);
  }
  const pythonVersion = facts.pythonVersion();
  if (pythonVersion === null) {
    issues.push("Python 3 is required but was not found.");
  } else {
    const match = /^(\d+)\.(\d+)(?:\.|$)/u.exec(pythonVersion);
    const pythonMajor = Number(match?.[1]);
    const pythonMinor = Number(match?.[2]);
    if (
      match === null ||
      pythonMajor < 3 ||
      (pythonMajor === 3 && pythonMinor < 11)
    ) {
      issues.push(
        `Python 3.11 or newer is required; detected ${pythonVersion}.`,
      );
    }
  }
  return {
    capabilities: [...REPOSITORY_REPAIR_REQUIRED_CAPABILITIES],
    environment: {
      os: os === "darwin" ? "darwin" : "linux",
      architecture: facts.architecture(),
      cpuClass: facts.cpuModels()[0] ?? "unknown",
      memoryMb: Math.floor(facts.totalMemory() / 1024 / 1024),
      runtimeVersions: {
        node: nodeVersion,
        ...(pythonVersion === null ? {} : { python: pythonVersion }),
      },
      harnessVersions: {
        llmbench: "1.0.0",
        ...(facts.harnessVersions?.() ?? {}),
      },
      sandboxMode: "process",
      contentHashes: {
        runner: createHash("sha256")
          .update("@speirsy11/llm-bench-runner@0.0.0")
          .digest("hex"),
      },
    },
    issues,
  };
}

function detectPythonVersion(): string | null {
  const result = spawnSync(
    process.env.LLMBENCH_PYTHON ?? "python3",
    ["--version"],
    {
      encoding: "utf8",
      timeout: 2_000,
    },
  );
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout}${result.stderr}`.trim();
  return /^Python\s+/u.test(output) ? output.replace(/^Python\s+/u, "") : null;
}

function detectNativeHarnessVersions(): Record<string, string> {
  const codex = detectCommandVersion("codex", /^codex-cli\s+(\S+)$/u);
  const claude = detectCommandVersion("claude", /^(\S+)\s/u);
  return {
    ...(codex === null ? {} : { codex }),
    ...(claude === null ? {} : { claude }),
  };
}

function detectCommandVersion(binary: string, pattern: RegExp): string | null {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.error || result.status !== 0) return null;
  const match = pattern.exec(`${result.stdout}${result.stderr}`.trim());
  return match?.[1] ?? null;
}
