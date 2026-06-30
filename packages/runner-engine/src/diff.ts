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

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/**
 * Renders a diff as a deterministic unified-style text block. Missing sides are
 * marked with `/dev/null` headers and a trailing newline at end of file is
 * preserved, so distinct patches — an empty-file add versus remove, or `foo`
 * versus `foo\n` — never render (and therefore never hash) identically.
 */
export function renderDiffText(diff: WorkspaceDiff): string {
  const lines: string[] = [];
  for (const entry of diff.entries) {
    lines.push(
      entry.before === null ? "--- /dev/null" : `--- a/${entry.path}`,
      entry.after === null ? "+++ /dev/null" : `+++ b/${entry.path}`,
    );
    renderSide("-", entry.before, lines);
    renderSide("+", entry.after, lines);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function renderSide(
  prefix: string,
  content: string | null,
  lines: string[],
): void {
  if (content === null || content.length === 0) {
    return;
  }
  const segments = content.split("\n");
  const endsWithNewline = segments[segments.length - 1] === "";
  if (endsWithNewline) {
    segments.pop();
  }
  for (const segment of segments) {
    lines.push(`${prefix}${segment}`);
  }
  if (!endsWithNewline) {
    lines.push(NO_NEWLINE_MARKER);
  }
}
