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
