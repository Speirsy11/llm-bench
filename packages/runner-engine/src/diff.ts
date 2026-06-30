/**
 * Workspace diff capture. Comparing the prepared file tree against the tree the
 * harness left behind yields the final patch, which is recorded as honest
 * evidence of what the agent actually changed.
 */

export type DiffStatus = "added" | "removed" | "modified";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  before: string | null;
  after: string | null;
}

export interface WorkspaceDiff {
  entries: DiffEntry[];
  changedPaths: string[];
}

/** Diffs two path-to-content snapshots, omitting unchanged files. */
export function captureDiff(
  before: Map<string, string>,
  after: Map<string, string>,
): WorkspaceDiff {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const entries: DiffEntry[] = [];
  for (const path of [...paths].sort()) {
    const had = before.has(path);
    const has = after.has(path);
    const priorContent = before.get(path) ?? null;
    const nextContent = after.get(path) ?? null;
    if (had && has && priorContent === nextContent) {
      continue;
    }
    const status: DiffStatus = !had ? "added" : !has ? "removed" : "modified";
    entries.push({ path, status, before: priorContent, after: nextContent });
  }
  return { entries, changedPaths: entries.map((entry) => entry.path) };
}

/** Renders a diff as a deterministic unified-style text block. */
export function renderDiffText(diff: WorkspaceDiff): string {
  const lines: string[] = [];
  for (const entry of diff.entries) {
    lines.push(`--- a/${entry.path}`, `+++ b/${entry.path}`);
    for (const line of splitLines(entry.before)) {
      lines.push(`-${line}`);
    }
    for (const line of splitLines(entry.after)) {
      lines.push(`+${line}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function splitLines(content: string | null): string[] {
  if (content === null) {
    return [];
  }
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
