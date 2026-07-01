import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The single npm scope every workspace package must use. */
export const WORKSPACE_SCOPE = "@llm-bench";

/** The private root package is unscoped by convention. */
export const ROOT_PACKAGE_NAME = "llm-bench";

/** Public packages use the owner scope promised by the product contract. */
export const PUBLISHED_PACKAGE_NAMES = new Set([
  "@speirsy11/llm-bench-runner",
  "@speirsy11/llm-bench-harness-sdk",
]);

/**
 * Validate a single workspace package name against the LLMBench scope policy.
 * Returns a list of human-readable issues; an empty list means the name is
 * valid. The root package is allowed to remain unscoped.
 */
export function validateWorkspaceName(name: string): string[] {
  if (name === ROOT_PACKAGE_NAME || PUBLISHED_PACKAGE_NAMES.has(name)) {
    return [];
  }
  if (!name.startsWith(`${WORKSPACE_SCOPE}/`)) {
    return [`Package "${name}" must use the "${WORKSPACE_SCOPE}/" scope.`];
  }
  return [];
}

/**
 * Render a Handlebars-style package manifest template by substituting the
 * `{{ name }}` placeholder, mirroring what the package generator produces.
 */
export function renderPackageName(template: string, name: string): string {
  const manifest = JSON.parse(
    template.replace(/{{\s*name\s*}}/g, name),
  ) as Record<string, unknown>;
  const rendered = manifest.name;
  if (typeof rendered !== "string") {
    throw new Error("Rendered manifest is missing a string name field.");
  }
  return rendered;
}

/** Read the `packages:` globs declared in a pnpm workspace manifest. */
export function readWorkspaceGlobs(workspaceYaml: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of workspaceYaml.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      globs.push(stripQuotes(trimmed.slice(2).trim()));
      continue;
    }
    break;
  }
  return globs;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

/**
 * Resolve every workspace package manifest path from the repository root,
 * including the root manifest itself, by expanding `dir/*` globs.
 */
export function collectPackageJsonPaths(repoRoot: string): string[] {
  const workspaceYaml = readFileSync(
    join(repoRoot, "pnpm-workspace.yaml"),
    "utf8",
  );
  const paths = [join(repoRoot, "package.json")];
  for (const glob of readWorkspaceGlobs(workspaceYaml)) {
    const dir = glob.replace(/\/\*$/, "");
    for (const entry of readdirSync(join(repoRoot, dir), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        paths.push(join(repoRoot, dir, entry.name, "package.json"));
      }
    }
  }
  return paths;
}

/** Read the `name` field from a package manifest at the given path. */
export function readPackageName(packageJsonPath: string): string {
  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: unknown;
  };
  if (typeof manifest.name !== "string") {
    throw new Error(`Manifest at ${packageJsonPath} is missing a name.`);
  }
  return manifest.name;
}
