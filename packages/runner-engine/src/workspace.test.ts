import { existsSync, symlinkSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Workspace } from "./workspace";

describe("Workspace", () => {
  const opened: Workspace[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all([
      ...opened.splice(0).map((workspace) => workspace.cleanup()),
      ...tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    ]);
  });

  async function open(): Promise<Workspace> {
    const workspace = await Workspace.create(tmpdir());
    opened.push(workspace);
    return workspace;
  }

  it("creates an isolated directory that exists on disk", async () => {
    const workspace = await open();

    expect(existsSync(workspace.root)).toBe(true);
  });

  it("round-trips file contents through writeFile and readFile", async () => {
    const workspace = await open();

    await workspace.writeFile("src/sum.mjs", "export const x = 1;\n");

    expect(await workspace.readFile("src/sum.mjs")).toBe(
      "export const x = 1;\n",
    );
  });

  it("reports whether a relative path exists", async () => {
    const workspace = await open();

    expect(await workspace.exists("missing.txt")).toBe(false);
    await workspace.writeFile("present.txt", "hi");
    expect(await workspace.exists("present.txt")).toBe(true);
  });

  it("lists written files as sorted relative paths", async () => {
    const workspace = await open();

    await workspace.writeFile("b.txt", "b");
    await workspace.writeFile("nested/a.txt", "a");

    expect(await workspace.list()).toEqual(["b.txt", "nested/a.txt"]);
  });

  it("snapshots the file tree as a path-to-content map", async () => {
    const workspace = await open();

    await workspace.writeFile("a.txt", "alpha");
    await workspace.writeFile("dir/b.txt", "beta");

    expect(await workspace.snapshot()).toEqual(
      new Map([
        ["a.txt", "alpha"],
        ["dir/b.txt", "beta"],
      ]),
    );
  });

  it("rejects absolute paths", async () => {
    const workspace = await open();

    await expect(workspace.resolve("/etc/passwd")).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it("rejects parent-directory traversal", async () => {
    const workspace = await open();

    await expect(workspace.resolve("../escape.txt")).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it("rejects paths that escape through a symlink", async () => {
    const workspace = await open();
    const outside = await mkdtemp(path.join(tmpdir(), "outside-"));
    tempDirs.push(outside);
    symlinkSync(outside, path.join(workspace.root, "link"));

    await expect(workspace.resolve("link/secret.txt")).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it("resolves a contained path to an absolute location inside the root", async () => {
    const workspace = await open();

    const resolved = await workspace.resolve("nested/file.txt");

    const real = await realpath(workspace.root);
    expect(resolved.startsWith(real + path.sep)).toBe(true);
  });

  it("deletes the workspace tree on cleanup", async () => {
    const workspace = await open();
    await workspace.writeFile("file.txt", "data");

    await workspace.cleanup();

    expect(existsSync(workspace.root)).toBe(false);
  });

  it("treats cleanup as idempotent", async () => {
    const workspace = await open();

    await workspace.cleanup();
    await expect(workspace.cleanup()).resolves.toBeUndefined();
  });

  it("does not leak written bytes outside the root", async () => {
    const workspace = await open();
    await workspace.writeFile("dir/inner.txt", "contained");

    const onDisk = await readFile(
      path.join(workspace.root, "dir", "inner.txt"),
      "utf8",
    );
    expect(onDisk).toBe("contained");
  });
});
