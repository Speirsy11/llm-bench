import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PathEscapeError, resolveWithinRoot } from "./path";

const root = "/repo/work";

describe("resolveWithinRoot", () => {
  it("resolves nested relative paths inside the root", () => {
    expect(resolveWithinRoot(root, "src/index.ts")).toBe(
      resolve(root, "src/index.ts"),
    );
    expect(resolveWithinRoot(root, "./a/../b.ts")).toBe(resolve(root, "b.ts"));
  });

  it("allows the root itself", () => {
    expect(resolveWithinRoot(root, ".")).toBe(resolve(root));
    expect(resolveWithinRoot(root, "")).toBe(resolve(root));
  });

  it("rejects parent traversal", () => {
    expect(() => resolveWithinRoot(root, "../secret")).toThrow(PathEscapeError);
    expect(() => resolveWithinRoot(root, "a/../../secret")).toThrow(
      PathEscapeError,
    );
    expect(() => resolveWithinRoot(root, "..")).toThrow(PathEscapeError);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveWithinRoot(root, "/etc/passwd")).toThrow(PathEscapeError);
  });
});
