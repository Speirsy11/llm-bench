import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTool, ToolContext } from "../types";
import { PathEscapeError } from "../path";
import { createRepositoryTools, ToolInputError } from "./repository";

let root: string;
let tools: Map<string, AgentTool>;
let context: ToolContext;

function tool(name: string): AgentTool {
  return getTool(tools, name);
}

function getTool(map: Map<string, AgentTool>, name: string): AgentTool {
  const found = map.get(name);
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "llm-bench-repo-"));
  tools = new Map(
    createRepositoryTools(root).map((t) => [t.definition.name, t]),
  );
  context = { root, signal: new AbortController().signal };
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "a.ts"),
    "export const a = 1;\nconst secret = 2;\n",
  );
  await writeFile(join(root, "README.md"), "# Title\n");
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "junk.ts"), "secret\n");
});

describe("read_file", () => {
  it("reads a contained file", async () => {
    expect(
      await tool("read_file").execute(
        JSON.stringify({ path: "README.md" }),
        context,
      ),
    ).toBe("# Title\n");
  });

  it("continues reading after a short filesystem read", async () => {
    await writeFile(join(root, "short-read.txt"), "abcd");
    const handle = await open(join(root, "short-read.txt"), "r");
    const prototype = Object.getPrototypeOf(handle) as typeof handle;
    await handle.close();
    const contents = Buffer.from("abcd");
    const read = vi.spyOn(prototype, "read").mockImplementation(((
      buffer: Buffer,
      offset: number,
      _length: number,
      position: number,
    ) => {
      contents.copy(buffer, offset, position, position + 1);
      return Promise.resolve({ bytesRead: 1, buffer });
    }) as never);

    try {
      await expect(
        tool("read_file").execute(
          JSON.stringify({ path: "short-read.txt" }),
          context,
        ),
      ).resolves.toBe("abcd");
    } finally {
      read.mockRestore();
    }
  });

  it("fails closed if a file is truncated while being read", async () => {
    await writeFile(join(root, "truncated.txt"), "abcd");
    const handle = await open(join(root, "truncated.txt"), "r");
    const prototype = Object.getPrototypeOf(handle) as typeof handle;
    const read = vi.spyOn(prototype, "read").mockResolvedValue({
      bytesRead: 0,
      buffer: Buffer.alloc(4),
    });
    await handle.close();

    try {
      await expect(
        tool("read_file").execute(
          JSON.stringify({ path: "truncated.txt" }),
          context,
        ),
      ).rejects.toThrow("Repository file changed while it was being read.");
    } finally {
      read.mockRestore();
    }
  });

  it("rejects files larger than the configured byte limit", async () => {
    await writeFile(join(root, "unicode.txt"), "ééé");
    const tools2 = new Map(
      createRepositoryTools(root, { maxReadBytes: 4 }).map((t) => [
        t.definition.name,
        t,
      ]),
    );
    await expect(
      getTool(tools2, "read_file").execute(
        JSON.stringify({ path: "unicode.txt" }),
        context,
      ),
    ).rejects.toThrow(
      "read_file cannot read unicode.txt: file exceeds 4 bytes.",
    );
  });

  it("rejects path escapes and bad arguments", async () => {
    await expect(
      tool("read_file").execute(JSON.stringify({ path: "../escape" }), context),
    ).rejects.toBeInstanceOf(PathEscapeError);
    await expect(
      tool("read_file").execute("{bad", context),
    ).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      tool("read_file").execute(JSON.stringify([]), context),
    ).rejects.toThrow(/must be a JSON object/);
    await expect(
      tool("read_file").execute(JSON.stringify({ path: 1 }), context),
    ).rejects.toThrow(/must be a string/);
  });

  it("rejects reads through symlinks outside the repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "llm-bench-outside-"));
    await writeFile(join(outside, "secret.txt"), "host secret");
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));

    await expect(
      tool("read_file").execute(
        JSON.stringify({ path: "escape.txt" }),
        context,
      ),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });
});

describe("list_directory", () => {
  it("lists entries and hides ignored directories", async () => {
    const listing = await tool("list_directory").execute("{}", context);
    expect(listing).toContain("file README.md");
    expect(listing).toContain("dir  src");
    expect(listing).not.toContain("node_modules");
  });

  it("defaults to the root for empty arguments", async () => {
    const listing = await tool("list_directory").execute("", context);
    expect(listing).toContain("file README.md");
  });

  it("lists a subdirectory", async () => {
    const listing = await tool("list_directory").execute(
      JSON.stringify({ path: "src" }),
      context,
    );
    expect(listing).toBe("file a.ts");
  });

  it("rejects directories larger than the configured entry limit", async () => {
    const limitedTools = new Map(
      createRepositoryTools(root, { maxListEntries: 1 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "list_directory").execute("{}", context),
    ).rejects.toThrow(
      "list_directory cannot list .: directory exceeds 1 entries.",
    );
  });

  it("rejects listings larger than the configured byte limit", async () => {
    await mkdir(join(root, "wide"));
    await writeFile(join(root, "wide", "é"), "");
    const limitedTools = new Map(
      createRepositoryTools(root, { maxListBytes: 6 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "list_directory").execute(
        JSON.stringify({ path: "wide" }),
        context,
      ),
    ).rejects.toThrow(
      "list_directory cannot list wide: result exceeds 6 bytes.",
    );
  });

  it("rejects listings through symlinked directories", async () => {
    const outside = await mkdtemp(join(tmpdir(), "llm-bench-outside-"));
    await writeFile(join(outside, "secret.txt"), "host secret");
    await symlink(outside, join(root, "escape"));

    await expect(
      tool("list_directory").execute(
        JSON.stringify({ path: "escape" }),
        context,
      ),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });
});

describe("search_files", () => {
  it("finds literal matches and skips ignored directories", async () => {
    const result = await tool("search_files").execute(
      JSON.stringify({ query: "secret" }),
      context,
    );
    expect(result).toContain("src/a.ts:2:");
    expect(result).not.toContain("node_modules");
  });

  it("reports when nothing matches", async () => {
    expect(
      await tool("search_files").execute(
        JSON.stringify({ query: "zzz" }),
        context,
      ),
    ).toBe("No matches found.");
  });

  it("rejects an empty query", async () => {
    await expect(
      tool("search_files").execute(JSON.stringify({ query: "" }), context),
    ).rejects.toThrow(/must not be empty/);
  });

  it("caps the number of matches", async () => {
    await writeFile(join(root, "many.txt"), "hit\n".repeat(10));
    const tools2 = new Map(
      createRepositoryTools(root, { maxSearchResults: 3 }).map((t) => [
        t.definition.name,
        t,
      ]),
    );
    const result = await getTool(tools2, "search_files").execute(
      JSON.stringify({ query: "hit" }),
      context,
    );
    expect(result.split("\n")).toHaveLength(3);
  });

  it("returns capped matches in deterministic path order", async () => {
    const orderedRoot = await mkdtemp(join(tmpdir(), "llm-bench-search-"));
    await writeFile(join(orderedRoot, "z.txt"), "hit");
    await writeFile(join(orderedRoot, "a.txt"), "hit");
    const orderedTools = new Map(
      createRepositoryTools(orderedRoot, { maxSearchResults: 1 }).map(
        (candidate) => [candidate.definition.name, candidate],
      ),
    );

    await expect(
      getTool(orderedTools, "search_files").execute(
        JSON.stringify({ query: "hit" }),
        { root: orderedRoot, signal: context.signal },
      ),
    ).resolves.toBe("a.txt:1: hit");
  });

  it("rejects search results larger than the configured byte limit", async () => {
    await writeFile(join(root, "unicode.txt"), "é\n");
    const limitedTools = new Map(
      createRepositoryTools(root, { maxSearchBytes: 5 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "search_files").execute(
        JSON.stringify({ query: "é" }),
        context,
      ),
    ).rejects.toThrow("search_files result exceeds 5 bytes.");
  });

  it("bounds the number of filesystem entries scanned", async () => {
    const limitedRoot = await mkdtemp(join(tmpdir(), "llm-bench-search-"));
    await writeFile(join(limitedRoot, "a.txt"), "first");
    await writeFile(join(limitedRoot, "b.txt"), "second");
    const limitedTools = new Map(
      createRepositoryTools(limitedRoot, { maxSearchEntries: 1 }).map(
        (candidate) => [candidate.definition.name, candidate],
      ),
    );

    await expect(
      getTool(limitedTools, "search_files").execute(
        JSON.stringify({ query: "missing" }),
        { root: limitedRoot, signal: context.signal },
      ),
    ).rejects.toThrow("search_files scan exceeds 1 entries.");
  });

  it("bounds aggregate bytes scanned", async () => {
    const limitedRoot = await mkdtemp(join(tmpdir(), "llm-bench-search-"));
    await writeFile(join(limitedRoot, "a.txt"), "abcd");
    await writeFile(join(limitedRoot, "b.txt"), "efgh");
    const limitedTools = new Map(
      createRepositoryTools(limitedRoot, { maxSearchScanBytes: 5 }).map(
        (candidate) => [candidate.definition.name, candidate],
      ),
    );

    await expect(
      getTool(limitedTools, "search_files").execute(
        JSON.stringify({ query: "missing" }),
        { root: limitedRoot, signal: context.signal },
      ),
    ).rejects.toThrow("search_files scan exceeds 5 bytes.");
  });

  it("stops traversal as soon as the result limit is reached", async () => {
    const limitedRoot = await mkdtemp(join(tmpdir(), "llm-bench-search-"));
    await writeFile(join(limitedRoot, "a.txt"), "hit");
    await mkdir(join(limitedRoot, "z"));
    await writeFile(join(limitedRoot, "z", "late.txt"), "hit");
    const limitedTools = new Map(
      createRepositoryTools(limitedRoot, {
        maxSearchEntries: 2,
        maxSearchResults: 1,
      }).map((candidate) => [candidate.definition.name, candidate]),
    );

    await expect(
      getTool(limitedTools, "search_files").execute(
        JSON.stringify({ query: "hit" }),
        { root: limitedRoot, signal: context.signal },
      ),
    ).resolves.toBe("a.txt:1: hit");
  });

  it("skips oversized files while walking", async () => {
    await writeFile(join(root, "big.txt"), "secret\n".repeat(2000));
    const tools2 = new Map(
      createRepositoryTools(root, { maxReadBytes: 16 }).map((t) => [
        t.definition.name,
        t,
      ]),
    );
    const result = await getTool(tools2, "search_files").execute(
      JSON.stringify({ query: "secret" }),
      context,
    );
    expect(result).not.toContain("big.txt");
  });

  it("stops walking when the run is aborted", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const result = await tool("search_files").execute(
      JSON.stringify({ query: "secret" }),
      { root, signal: aborted.signal },
    );
    expect(result).toBe("No matches found.");
  });
});

describe("apply_patch", () => {
  it("replaces a unique snippet", async () => {
    const result = await tool("apply_patch").execute(
      JSON.stringify({
        path: "README.md",
        oldText: "Title",
        newText: "Heading",
      }),
      context,
    );
    expect(result).toBe("Patched README.md.");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# Heading\n");
  });

  it("creates a new file when oldText is empty", async () => {
    await tool("apply_patch").execute(
      JSON.stringify({
        path: "src/new.ts",
        oldText: "",
        newText: "export const x = 1;",
      }),
      context,
    );
    expect(await readFile(join(root, "src", "new.ts"), "utf8")).toBe(
      "export const x = 1;",
    );
  });

  it("rejects oversized new files without creating a partial file", async () => {
    const limitedTools = new Map(
      createRepositoryTools(root, { maxPatchBytes: 4 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "apply_patch").execute(
        JSON.stringify({
          path: "src/too-large.ts",
          oldText: "",
          newText: "ééé",
        }),
        context,
      ),
    ).rejects.toThrow(
      "apply_patch cannot write src/too-large.ts: content exceeds 4 bytes.",
    );
    await expect(
      readFile(join(root, "src", "too-large.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects oversized patch reads without changing the file", async () => {
    await writeFile(join(root, "existing.txt"), "ééé");
    const limitedTools = new Map(
      createRepositoryTools(root, { maxPatchBytes: 4 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "apply_patch").execute(
        JSON.stringify({
          path: "existing.txt",
          oldText: "é",
          newText: "x",
        }),
        context,
      ),
    ).rejects.toThrow(
      "apply_patch cannot read existing.txt: file exceeds 4 bytes.",
    );
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("ééé");
  });

  it("rejects oversized patch writes without changing the file", async () => {
    await writeFile(join(root, "existing.txt"), "abc");
    const limitedTools = new Map(
      createRepositoryTools(root, { maxPatchBytes: 4 }).map((candidate) => [
        candidate.definition.name,
        candidate,
      ]),
    );

    await expect(
      getTool(limitedTools, "apply_patch").execute(
        JSON.stringify({
          path: "existing.txt",
          oldText: "b",
          newText: "éé",
        }),
        context,
      ),
    ).rejects.toThrow(
      "apply_patch cannot write existing.txt: content exceeds 4 bytes.",
    );
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("abc");
  });

  it("fails when the snippet is missing or ambiguous", async () => {
    await writeFile(join(root, "dup.txt"), "aa");
    await expect(
      tool("apply_patch").execute(
        JSON.stringify({ path: "dup.txt", oldText: "z", newText: "y" }),
        context,
      ),
    ).rejects.toThrow(/not found/);
    await expect(
      tool("apply_patch").execute(
        JSON.stringify({ path: "dup.txt", oldText: "a", newText: "y" }),
        context,
      ),
    ).rejects.toThrow(/not unique/);
  });

  it("rejects writes outside the root", async () => {
    await expect(
      tool("apply_patch").execute(
        JSON.stringify({ path: "../evil.txt", oldText: "", newText: "x" }),
        context,
      ),
    ).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("rejects creates and replacements through symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "llm-bench-outside-"));
    await writeFile(join(outside, "secret.txt"), "host secret");
    await symlink(outside, join(root, "escape"));
    await symlink(join(outside, "secret.txt"), join(root, "secret-link"));

    await expect(
      tool("apply_patch").execute(
        JSON.stringify({
          path: "escape/new.txt",
          oldText: "",
          newText: "unexpected",
        }),
        context,
      ),
    ).rejects.toBeInstanceOf(PathEscapeError);
    await expect(
      tool("apply_patch").execute(
        JSON.stringify({
          path: "secret-link",
          oldText: "secret",
          newText: "changed",
        }),
        context,
      ),
    ).rejects.toBeInstanceOf(PathEscapeError);
    await expect(
      readFile(join(outside, "new.txt"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe(
      "host secret",
    );
  });
});
