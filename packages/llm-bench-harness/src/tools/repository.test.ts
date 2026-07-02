import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

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

  it("truncates large files", async () => {
    const tools2 = new Map(
      createRepositoryTools(root, { maxReadBytes: 4 }).map((t) => [
        t.definition.name,
        t,
      ]),
    );
    const result = await getTool(tools2, "read_file").execute(
      JSON.stringify({ path: "README.md" }),
      context,
    );
    expect(result).toBe("# Ti\n[truncated]");
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
});
