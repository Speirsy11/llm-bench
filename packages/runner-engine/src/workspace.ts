import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

/**
 * An ephemeral workspace rooted at a unique temporary directory. Every path is
 * resolved through {@link Workspace.resolve}, which contains access to the root:
 * absolute paths, parent-directory traversal, and symlink escapes are rejected
 * so a benchmark task can never read or write outside its sandbox.
 */
export class Workspace {
  private constructor(readonly root: string) {}

  /** Creates a fresh, isolated workspace directory under `parent`. */
  static async create(parent: string): Promise<Workspace> {
    const root = await mkdtemp(path.join(parent, "llm-bench-workspace-"));
    return new Workspace(await realpath(root));
  }

  /**
   * Resolves a workspace-relative path to an absolute location, rejecting any
   * path that would escape the root by absolute reference, `..` traversal, or a
   * symlink pointing outside the sandbox.
   */
  async resolve(relativePath: string): Promise<string> {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Path "${relativePath}" is outside the workspace.`);
    }
    const target = path.resolve(this.root, relativePath);
    const fromRoot = path.relative(this.root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`)) {
      throw new Error(`Path "${relativePath}" is outside the workspace.`);
    }
    const realTarget = await this.realExistingAncestor(target);
    if (!this.contains(realTarget)) {
      throw new Error(`Path "${relativePath}" is outside the workspace.`);
    }
    return target;
  }

  /** Writes UTF-8 content to a contained path, creating parent directories. */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const target = await this.resolve(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  /** Reads UTF-8 content from a contained path. */
  async readFile(relativePath: string): Promise<string> {
    return readFile(await this.resolve(relativePath), "utf8");
  }

  /** Whether a contained path currently exists. */
  async exists(relativePath: string): Promise<boolean> {
    const target = await this.resolve(relativePath);
    return readdir(path.dirname(target))
      .then((entries) => entries.includes(path.basename(target)))
      .catch(() => false);
  }

  /** Sorted relative paths of every file in the workspace tree. */
  async list(): Promise<string[]> {
    const files = await this.walk(this.root);
    return files.map((file) => path.relative(this.root, file)).sort();
  }

  /** Snapshot of the whole tree as a relative-path-to-content map. */
  async snapshot(): Promise<Map<string, string>> {
    const entries = await this.list();
    const snapshot = new Map<string, string>();
    for (const entry of entries) {
      snapshot.set(entry, await this.readFile(entry));
    }
    return snapshot;
  }

  /** Removes the workspace tree. Safe to call more than once. */
  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private contains(candidate: string): boolean {
    return (
      candidate === this.root || candidate.startsWith(this.root + path.sep)
    );
  }

  private async realExistingAncestor(target: string): Promise<string> {
    // `target` is lexically inside the root, so the root is always an existing
    // ancestor and the walk terminates there at the latest.
    let current = target;
    while (current !== this.root) {
      try {
        return await realpath(current);
      } catch {
        current = path.dirname(current);
      }
    }
    return realpath(this.root);
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.walk(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  }
}
