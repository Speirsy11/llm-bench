import type { Capability } from "./capability";
import type { RunnerExecution } from "./runner-protocol";

export const REPOSITORY_REPAIR_REQUIRED_CAPABILITIES = [
  "response_generation",
  "workspaces",
  "files",
] as const satisfies readonly Capability[];

export const LLMBENCH_REPOSITORY_TOOLS = [
  "read_file",
  "list_directory",
  "search_files",
  "apply_patch",
] as const;

const SUPPORTED_HARNESS_VERSION = "1.0.0";
const SUPPORTED_TOOLSET_VERSION = "1.0.0";
const nativeHarnesses = new Set(["codex", "claude", "pi"]);
const preflightedNativeHarnesses = new Set(["codex", "claude"]);
const supportedHarnesses = new Set(["llmbench", ...nativeHarnesses]);
const semanticCliVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Pure preflight shared by launch, durable claim, and runner execution. */
export function targetCompatibilityBlockers(
  target: RunnerExecution["target"],
  requiredCapabilities: readonly Capability[],
  llmBenchTools: readonly string[],
  runnerHarnessVersions?: Readonly<Record<string, string>>,
): string[] {
  const blockers: string[] = [];
  if (!supportedHarnesses.has(target.harness.id)) {
    blockers.push(`Harness ${target.harness.id} is unsupported.`);
  }
  if (
    supportedHarnesses.has(target.harness.id) &&
    target.harness.version !== SUPPORTED_HARNESS_VERSION
  ) {
    blockers.push(
      `Harness ${target.harness.id} version ${target.harness.version} is unsupported; expected ${SUPPORTED_HARNESS_VERSION}.`,
    );
  }
  if (runnerHarnessVersions !== undefined) {
    const nativeCliBlocker = nativeHarnessCliBlocker(
      target.harness.id,
      runnerHarnessVersions,
    );
    if (nativeCliBlocker) blockers.push(nativeCliBlocker);
  }
  const route = target.harness.modelRoutes.find(
    (candidate) => candidate.id === target.modelRoute.id,
  );
  if (
    route === undefined ||
    route.provider !== target.modelRoute.provider ||
    route.model !== target.modelRoute.model
  ) {
    blockers.push(
      `Selected model route ${target.modelRoute.id} is not declared by harness ${target.harness.id}.`,
    );
  }
  for (const capability of requiredCapabilities) {
    if (!target.harness.capabilities.includes(capability)) {
      blockers.push(
        `Harness ${target.harness.id} lacks required capability ${capability}.`,
      );
    }
  }
  if (target.harness.id === "llmbench") {
    if (target.modelRoute.provider !== "openrouter") {
      blockers.push("LLMBench requires an OpenRouter model route.");
    }
    const selected = new Set(target.toolset.tools);
    if (
      target.toolset.id !== "builtin" ||
      target.toolset.version !== SUPPORTED_TOOLSET_VERSION ||
      target.toolset.tools.length !== llmBenchTools.length ||
      selected.size !== llmBenchTools.length ||
      llmBenchTools.some((tool) => !selected.has(tool))
    ) {
      blockers.push(
        `LLMBench repository repair requires builtin toolset ${SUPPORTED_TOOLSET_VERSION} with tools: ${llmBenchTools.join(", ")}.`,
      );
    }
  } else {
    if (
      nativeHarnesses.has(target.harness.id) &&
      (target.toolset.id !== "native" ||
        target.toolset.version !== SUPPORTED_TOOLSET_VERSION)
    ) {
      blockers.push(
        `Harness ${target.harness.id} requires native toolset ${SUPPORTED_TOOLSET_VERSION}.`,
      );
    }
    if (target.toolset.tools.length > 0) {
      blockers.push(
        `Harness ${target.harness.id} uses native tools and cannot receive runner-managed tools.`,
      );
    }
  }
  if (target.toolset.mcpProfiles.length > 0) {
    blockers.push(
      `Harness ${target.harness.id} does not support runner-managed MCP profiles.`,
    );
  }
  return blockers;
}

/** Runner-specific native CLI availability check shared by control and UI. */
export function nativeHarnessCliBlocker(
  harnessId: string,
  runnerHarnessVersions: Readonly<Record<string, string>>,
): string | null {
  if (!preflightedNativeHarnesses.has(harnessId)) return null;
  const version = runnerHarnessVersions[harnessId];
  if (version === undefined) {
    return `Runner does not advertise an installed ${harnessId} CLI.`;
  }
  if (!semanticCliVersion.test(version)) {
    return `Runner advertises an incompatible ${harnessId} CLI version: ${version}.`;
  }
  return null;
}
