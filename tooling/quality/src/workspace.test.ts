import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectPackageJsonPaths,
  readPackageName,
  readWorkspaceGlobs,
  renderPackageName,
  validateWorkspaceName,
} from "./workspace";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("validateWorkspaceName", () => {
  it("accepts names under the @llm-bench scope", () => {
    expect(validateWorkspaceName("@llm-bench/eslint-config")).toEqual([]);
  });

  it("accepts the unscoped root package", () => {
    expect(validateWorkspaceName("llm-bench")).toEqual([]);
  });

  it("rejects names under a foreign scope", () => {
    expect(validateWorkspaceName("@charlie/eslint-config")).toEqual([
      'Package "@charlie/eslint-config" must use the "@llm-bench/" scope.',
    ]);
  });
});

describe("package generator template", () => {
  it("produces a package under the @llm-bench scope", () => {
    const template = readFileSync(
      join(repoRoot, "turbo/generators/templates/package.json.hbs"),
      "utf8",
    );

    const generatedName = renderPackageName(template, "example-feature");

    expect(validateWorkspaceName(generatedName)).toEqual([]);
  });

  it("throws when the rendered manifest has no string name", () => {
    expect(() => renderPackageName('{ "private": true }', "x")).toThrow(
      /missing a string name/,
    );
  });
});

describe("workspace manifests", () => {
  it("reads package globs, ignoring lines outside the packages block", () => {
    expect(
      readWorkspaceGlobs(
        "# comment\npackages:\n  - tooling/*\n  - packages/*\ncatalog:\n",
      ),
    ).toEqual(["tooling/*", "packages/*"]);
  });

  it("every workspace package uses the @llm-bench scope", () => {
    const issues = collectPackageJsonPaths(repoRoot)
      .map(readPackageName)
      .flatMap(validateWorkspaceName);

    expect(issues).toEqual([]);
  });

  it("throws when a manifest is missing its name", () => {
    const dir = mkdtempSync(join(tmpdir(), "llm-bench-quality-"));
    const manifestPath = join(dir, "package.json");
    writeFileSync(manifestPath, '{ "private": true }');

    expect(() => readPackageName(manifestPath)).toThrow(/missing a name/);
  });
});
