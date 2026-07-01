import { createHash } from "node:crypto";
import { arch, cpus, platform, totalmem } from "node:os";

import type { CapabilityProbe } from "./cli-app";

interface SystemFacts {
  platform(): NodeJS.Platform;
  nodeVersion: string;
  architecture(): string;
  cpuModels(): string[];
  totalMemory(): number;
}

export function probeRunnerSystem(
  facts: SystemFacts = {
    platform,
    nodeVersion: process.versions.node,
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
  return {
    capabilities: ["workspaces", "files"],
    environment: {
      os: os === "darwin" ? "darwin" : "linux",
      architecture: facts.architecture(),
      cpuClass: facts.cpuModels()[0] ?? "unknown",
      memoryMb: Math.floor(facts.totalMemory() / 1024 / 1024),
      runtimeVersions: { node: nodeVersion },
      harnessVersions: { fixture: "1.0.0" },
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
