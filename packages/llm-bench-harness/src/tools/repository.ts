import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  opendir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { AgentTool, ToolContext } from "../types";
import { PathEscapeError, resolveWithinRoot } from "../path";

/** Raised for invalid tool arguments; surfaced to the model as a failed result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export interface RepositoryToolOptions {
  /** Maximum UTF-8 bytes read by `read_file` or from each searched file. */
  maxReadBytes?: number;
  /** Maximum visible entries returned by `list_directory`. */
  maxListEntries?: number;
  /** Maximum UTF-8 bytes returned by `list_directory`. */
  maxListBytes?: number;
  /** Maximum number of search matches returned. */
  maxSearchResults?: number;
  /** Maximum UTF-8 bytes returned by `search_files`. */
  maxSearchBytes?: number;
  /** Maximum visible filesystem entries visited by `search_files`. */
  maxSearchEntries?: number;
  /** Maximum aggregate file bytes inspected by `search_files`. */
  maxSearchScanBytes?: number;
  /** Maximum UTF-8 bytes read or written by `apply_patch`. */
  maxPatchBytes?: number;
  /** Directory names skipped while listing and searching. */
  ignoredDirectories?: readonly string[];
}

interface ResolvedConfig {
  maxReadBytes: number;
  maxListEntries: number;
  maxListBytes: number;
  maxSearchResults: number;
  maxSearchBytes: number;
  maxSearchEntries: number;
  maxSearchScanBytes: number;
  maxPatchBytes: number;
  ignoredDirectories: readonly string[];
}

const DEFAULTS: ResolvedConfig = {
  maxReadBytes: 64 * 1024,
  maxListEntries: 1_000,
  maxListBytes: 64 * 1024,
  maxSearchResults: 50,
  maxSearchBytes: 64 * 1024,
  maxSearchEntries: 10_000,
  maxSearchScanBytes: 4 * 1024 * 1024,
  maxPatchBytes: 64 * 1024,
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
    applyPatchTool(config),
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
      const resolved = await resolveExistingPath(context.root, path);
      const file = await readWithinLimit(resolved, config.maxReadBytes);
      if (file === undefined) {
        throw new ToolInputError(
          `read_file cannot read ${path}: file exceeds ${config.maxReadBytes} bytes.`,
        );
      }
      return file.content;
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
      const resolved = await resolveExistingPath(context.root, path);
      const visibleEntries = [];
      const directory = await opendir(resolved);
      for await (const entry of directory) {
        if (config.ignoredDirectories.includes(entry.name)) continue;
        if (visibleEntries.length >= config.maxListEntries) {
          throw new ToolInputError(
            `list_directory cannot list ${path}: directory exceeds ${config.maxListEntries} entries.`,
          );
        }
        visibleEntries.push(entry);
      }
      const listing = visibleEntries
        .map(
          (entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`,
        )
        .sort()
        .join("\n");
      if (Buffer.byteLength(listing, "utf8") > config.maxListBytes) {
        throw new ToolInputError(
          `list_directory cannot list ${path}: result exceeds ${config.maxListBytes} bytes.`,
        );
      }
      return listing;
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
      const search = { entries: 0, bytes: 0 };
      await walk(
        context.root,
        context.root,
        config,
        context,
        search,
        () => matches.length >= config.maxSearchResults,
        (rel, content, bytes) => {
          search.bytes += bytes;
          if (search.bytes > config.maxSearchScanBytes) {
            throw new ToolInputError(
              `search_files scan exceeds ${config.maxSearchScanBytes} bytes.`,
            );
          }
          const lines = content.split("\n");
          for (const [i, line] of lines.entries()) {
            if (matches.length >= config.maxSearchResults) return;
            if (line.includes(query))
              matches.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        },
      );
      const result =
        matches.length > 0 ? matches.join("\n") : "No matches found.";
      if (Buffer.byteLength(result, "utf8") > config.maxSearchBytes) {
        throw new ToolInputError(
          `search_files result exceeds ${config.maxSearchBytes} bytes.`,
        );
      }
      return result;
    },
  };
}

async function walk(
  root: string,
  dir: string,
  config: ResolvedConfig,
  context: ToolContext,
  search: { entries: number; bytes: number },
  shouldStop: () => boolean,
  visit: (relativePath: string, content: string, bytes: number) => void,
): Promise<void> {
  const directory = await opendir(dir);
  const entries = [];
  for await (const entry of directory) {
    if (context.signal.aborted) return;
    if (config.ignoredDirectories.includes(entry.name)) continue;
    search.entries += 1;
    if (search.entries > config.maxSearchEntries) {
      throw new ToolInputError(
        `search_files scan exceeds ${config.maxSearchEntries} entries.`,
      );
    }
    entries.push(entry);
  }
  entries.sort(({ name: left }, { name: right }) => (left < right ? -1 : 1));
  for (const entry of entries) {
    if (context.signal.aborted || shouldStop()) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, config, context, search, shouldStop, visit);
    } else if (entry.isFile()) {
      const file = await readWithinLimit(full, config.maxReadBytes);
      if (file === undefined) continue;
      visit(relative(root, full), file.content, file.bytes);
    }
  }
}

function applyPatchTool(config: ResolvedConfig): AgentTool {
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
        if (Buffer.byteLength(newText, "utf8") > config.maxPatchBytes) {
          throw new ToolInputError(
            `apply_patch cannot write ${path}: content exceeds ${config.maxPatchBytes} bytes.`,
          );
        }
        await resolveWritablePath(context.root, path);
        await writeAtomically(resolved, newText);
        return `Created ${path}.`;
      }
      const safeResolved = await resolveExistingPath(context.root, path);
      const file = await readWithinLimit(safeResolved, config.maxPatchBytes);
      if (file === undefined) {
        throw new ToolInputError(
          `apply_patch cannot read ${path}: file exceeds ${config.maxPatchBytes} bytes.`,
        );
      }
      const current = file.content;
      const occurrences = current.split(oldText).length - 1;
      if (occurrences === 0)
        throw new ToolInputError("`oldText` was not found.");
      if (occurrences > 1) throw new ToolInputError("`oldText` is not unique.");
      const updated = current.replace(oldText, newText);
      if (Buffer.byteLength(updated, "utf8") > config.maxPatchBytes) {
        throw new ToolInputError(
          `apply_patch cannot write ${path}: content exceeds ${config.maxPatchBytes} bytes.`,
        );
      }
      await writeAtomically(safeResolved, updated, file.mode);
      return `Patched ${path}.`;
    },
  };
}

interface BoundedFile {
  content: string;
  mode: number;
  bytes: number;
}

async function readWithinLimit(
  path: string,
  maxBytes: number,
): Promise<BoundedFile | undefined> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (info.size > maxBytes) return undefined;

    const buffer = Buffer.allocUnsafe(info.size);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) {
        throw new Error("Repository file changed while it was being read.");
      }
      bytesRead += result.bytesRead;
    }
    return {
      content: buffer.toString("utf8", 0, bytesRead),
      mode: info.mode,
      bytes: bytesRead,
    };
  } finally {
    await file.close();
  }
}

async function resolveExistingPath(
  root: string,
  requestedPath: string,
): Promise<string> {
  const resolved = resolveWithinRoot(root, requestedPath);
  await assertNoSymlinkSegments(root, resolved, requestedPath);
  const [actualRoot, actualPath] = await Promise.all([
    realpath(root),
    realpath(resolved),
  ]);
  assertRealPathWithinRoot(actualRoot, actualPath, requestedPath);
  return resolved;
}

async function resolveWritablePath(
  root: string,
  requestedPath: string,
): Promise<void> {
  const resolved = resolveWithinRoot(root, requestedPath);
  const parent = dirname(resolved);
  await assertNoSymlinkSegments(root, parent, requestedPath);
  const [actualRoot, actualParent] = await Promise.all([
    realpath(root),
    realpath(parent),
  ]);
  assertRealPathWithinRoot(actualRoot, actualParent, requestedPath);
}

async function assertNoSymlinkSegments(
  root: string,
  target: string,
  requestedPath: string,
): Promise<void> {
  const absoluteRoot = resolve(root);
  const relativePath = relative(absoluteRoot, target);
  let current = absoluteRoot;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new PathEscapeError(requestedPath);
    }
  }
}

function assertRealPathWithinRoot(
  actualRoot: string,
  actualPath: string,
  requestedPath: string,
): void {
  const rel = relative(actualRoot, actualPath);
  /* v8 ignore start -- defensive recheck for a concurrent symlink swap. */
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new PathEscapeError(requestedPath);
  }
  /* v8 ignore stop */
}

async function writeAtomically(
  target: string,
  content: string,
  mode?: number,
): Promise<void> {
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );
  try {
    if (mode === undefined) {
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
      await link(temporary, target);
    } else {
      await writeFile(temporary, content, {
        encoding: "utf8",
        flag: "wx",
        mode,
      });
      await rename(temporary, target);
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
