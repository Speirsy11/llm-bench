import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { AgentTool, ToolContext } from "../types";
import { resolveWithinRoot } from "../path";

/** Raised for invalid tool arguments; surfaced to the model as a failed result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export interface RepositoryToolOptions {
  /** Maximum bytes returned by `read_file`. */
  maxReadBytes?: number;
  /** Maximum number of search matches returned. */
  maxSearchResults?: number;
  /** Directory names skipped while listing and searching. */
  ignoredDirectories?: readonly string[];
}

interface ResolvedConfig {
  maxReadBytes: number;
  maxSearchResults: number;
  ignoredDirectories: readonly string[];
}

const DEFAULTS: ResolvedConfig = {
  maxReadBytes: 64 * 1024,
  maxSearchResults: 50,
  ignoredDirectories: ["node_modules", ".git", "dist", "coverage"],
};

function parseArguments(rawArguments: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments === "" ? "{}" : rawArguments);
  } catch {
    throw new ToolInputError("Tool arguments were not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ToolInputError("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ToolInputError(`\`${field}\` must be a string.`);
  }
  return value;
}

/** Builds the path-contained repository toolset for a run rooted at `root`. */
export function createRepositoryTools(
  root: string,
  options: RepositoryToolOptions = {},
): AgentTool[] {
  const config = { ...DEFAULTS, ...options };
  return [
    readFileTool(config),
    listDirectoryTool(config),
    searchFilesTool(config),
    applyPatchTool(),
  ];
}

function readFileTool(config: ResolvedConfig): AgentTool {
  return {
    definition: {
      name: "read_file",
      description: "Read a UTF-8 text file within the repository.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    async execute(rawArguments, context) {
      const path = requireString(parseArguments(rawArguments).path, "path");
      const resolved = resolveWithinRoot(context.root, path);
      const content = await readFile(resolved, "utf8");
      return content.length > config.maxReadBytes
        ? `${content.slice(0, config.maxReadBytes)}\n[truncated]`
        : content;
    },
  };
}

function listDirectoryTool(config: ResolvedConfig): AgentTool {
  return {
    definition: {
      name: "list_directory",
      description: "List entries of a directory within the repository.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
    async execute(rawArguments, context) {
      const raw = parseArguments(rawArguments).path;
      const path = raw === undefined ? "." : requireString(raw, "path");
      const resolved = resolveWithinRoot(context.root, path);
      const entries = await readdir(resolved, { withFileTypes: true });
      return entries
        .filter((entry) => !config.ignoredDirectories.includes(entry.name))
        .map(
          (entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`,
        )
        .sort()
        .join("\n");
    },
  };
}

function searchFilesTool(config: ResolvedConfig): AgentTool {
  return {
    definition: {
      name: "search_files",
      description: "Search repository files for a literal substring.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    async execute(rawArguments, context) {
      const query = requireString(parseArguments(rawArguments).query, "query");
      if (query.length === 0)
        throw new ToolInputError("`query` must not be empty.");
      const matches: string[] = [];
      await walk(
        context.root,
        context.root,
        config,
        context,
        (rel, content) => {
          const lines = content.split("\n");
          for (const [i, line] of lines.entries()) {
            if (matches.length >= config.maxSearchResults) return;
            if (line.includes(query))
              matches.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        },
      );
      return matches.length > 0 ? matches.join("\n") : "No matches found.";
    },
  };
}

async function walk(
  root: string,
  dir: string,
  config: ResolvedConfig,
  context: ToolContext,
  visit: (relativePath: string, content: string) => void,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (context.signal.aborted) return;
    if (config.ignoredDirectories.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, config, context, visit);
    } else if (entry.isFile()) {
      const info = await stat(full);
      if (info.size > config.maxReadBytes) continue;
      visit(relative(root, full), await readFile(full, "utf8"));
    }
  }
}

function applyPatchTool(): AgentTool {
  return {
    definition: {
      name: "apply_patch",
      description:
        "Replace a unique snippet in a file, or create it when `oldText` is empty.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
    async execute(rawArguments, context) {
      const args = parseArguments(rawArguments);
      const path = requireString(args.path, "path");
      const oldText = requireString(args.oldText, "oldText");
      const newText = requireString(args.newText, "newText");
      const resolved = resolveWithinRoot(context.root, path);

      if (oldText === "") {
        await writeFile(resolved, newText, { encoding: "utf8", flag: "wx" });
        return `Created ${path}.`;
      }
      const current = await readFile(resolved, "utf8");
      const occurrences = current.split(oldText).length - 1;
      if (occurrences === 0)
        throw new ToolInputError("`oldText` was not found.");
      if (occurrences > 1) throw new ToolInputError("`oldText` is not unique.");
      await writeFile(resolved, current.replace(oldText, newText), "utf8");
      return `Patched ${path}.`;
    },
  };
}
