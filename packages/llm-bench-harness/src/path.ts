import { isAbsolute, relative, resolve, sep } from "node:path";

/** Raised when a tool argument tries to escape the repository root. */
export class PathEscapeError extends Error {
  constructor(readonly requestedPath: string) {
    super(`Path escapes the repository root: ${requestedPath}`);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolves a user- or model-supplied path against the repository root and
 * guarantees the result stays inside it. Absolute paths, `..` traversal, and
 * anything that resolves outside the root are rejected.
 */
export function resolveWithinRoot(root: string, requestedPath: string): string {
  const absoluteRoot = resolve(root);
  if (isAbsolute(requestedPath)) throw new PathEscapeError(requestedPath);
  const resolved = resolve(absoluteRoot, requestedPath);
  const rel = relative(absoluteRoot, resolved);
  if (rel === "" || rel === ".") return resolved;
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new PathEscapeError(requestedPath);
  }
  return resolved;
}
