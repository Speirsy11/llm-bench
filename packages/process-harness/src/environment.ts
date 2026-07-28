const inheritedKeys = [
  "HOME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "CODEX_HOME",
] as const;

const isolatedKeys = [
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
] as const;

/** Builds a small, explicit child environment instead of leaking the runner's env. */
export function cleanProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of inheritedKeys) {
    const value = source[key];
    if (value !== undefined) clean[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) clean[key] = value;
  }
  return clean;
}

/**
 * Builds the stricter environment for explicitly installed plugins and MCP
 * servers. Home-directory variables and native harness authentication are
 * intentionally unavailable; only caller-supplied grants are added.
 */
export function isolatedProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  grants: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const isolated: NodeJS.ProcessEnv = {};
  for (const key of isolatedKeys) {
    const value = source[key];
    if (value !== undefined) isolated[key] = value;
  }
  for (const [key, value] of Object.entries(grants)) {
    if (value !== undefined) isolated[key] = value;
  }
  return isolated;
}
