import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url).pathname;
const temporaryRoot = mkdtempSync(join(tmpdir(), "llm-bench-harness-sdk-"));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(temporaryRoot, "npm-cache"),
};

try {
  /** @type {Record<string, { filename: string; files: { path: string }[] }> | { filename: string; files: { path: string }[]}[]} */
  const packResult = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", temporaryRoot],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: npmEnvironment,
      },
    ),
  );
  const packedPackage = Array.isArray(packResult)
    ? packResult[0]
    : Object.values(packResult)[0];
  if (packedPackage === undefined) {
    throw new Error("npm pack did not report a package archive.");
  }
  const archive = join(temporaryRoot, packedPackage.filename);
  const packedPaths = new Set(packedPackage.files.map((file) => file.path));
  if (
    !packedPaths.has("dist/index.d.ts") ||
    !packedPaths.has("dist/index.js")
  ) {
    throw new Error(
      "Packed SDK archive is missing its runtime or declaration entrypoint.",
    );
  }
  const consumerRoot = join(temporaryRoot, "consumer");
  const consumerModules = join(consumerRoot, "node_modules");
  const packageScope = join(consumerModules, "@speirsy11");
  mkdirSync(packageScope, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", packageScope]);
  renameSync(
    join(packageScope, "package"),
    join(packageScope, "llm-bench-harness-sdk"),
  );
  symlinkSync(
    join(packageRoot, "node_modules", "zod"),
    join(consumerModules, "zod"),
    "dir",
  );
  writeFileSync(
    join(consumerRoot, "index.ts"),
    [
      'import type { RunRequest } from "@speirsy11/llm-bench-harness-sdk";',
      "",
      "const request: RunRequest = {",
      '  kind: "run_request",',
      '  protocolVersion: "1.0.0",',
      '  job: { id: "ba0688bb-cfd1-455f-84d4-1238d18d9967", attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d" },',
      '  case: { id: "case-one", benchmarkId: "repair", benchmarkVersion: "1.0.0" },',
      '  prompt: "Fix it",',
      '  workspace: { root: "/workspace" },',
      '  toolset: { id: "repository", version: "1.0.0", tools: [], mcpProfiles: [] },',
      "  limits: { maxDurationMs: 60_000, maxToolCalls: 100, maxTokens: 10_000, maxTurns: 10 },",
      "  checkpoint: null,",
      "  credentials: {},",
      "  runtime: { mcpConnections: [] },",
      "};",
      "",
      "void request;",
      "",
    ].join("\n"),
  );
  execFileSync(
    join(packageRoot, "node_modules", ".bin", "tsc"),
    [
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "index.ts",
    ],
    { cwd: consumerRoot, stdio: "inherit" },
  );

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import { decodeProtocolLine } from "@speirsy11/llm-bench-harness-sdk"; console.log(decodeProtocolLine(\'{"kind":"handshake_request","protocolVersion":"1.0.0"}\').kind);',
    ],
    { cwd: consumerRoot, encoding: "utf8" },
  ).trim();
  if (output !== "handshake_request") {
    throw new Error(`Packed SDK import returned unexpected output: ${output}`);
  }
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
