import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeProtocolLine } from "@speirsy11/llm-bench-harness-sdk";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];

describe("the example harness executable", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  it("defaults to no grants and ignores an ambient provider credential", async () => {
    const buildRoot = await temporaryRoot("build");
    const executable = join(buildRoot, "example-harness.mjs");
    await build({
      entryPoints: [join(packageRoot, "src/cli.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      alias: {
        "@speirsy11/llm-bench-harness-sdk": join(
          packageRoot,
          "../harness-sdk/src/index.ts",
        ),
      },
      outfile: executable,
    });

    const workspace = await temporaryRoot("workspace");
    await mkdir(join(workspace, "src"));
    await writeFile(
      join(workspace, "src/clamp.cjs"),
      "function clamp(value) { return value; }\nmodule.exports = { clamp };\n",
      "utf8",
    );
    const ambientSecret = "ambient-provider-key-must-not-escape";
    const input = [
      JSON.stringify({
        kind: "handshake_request",
        protocolVersion: "1.0.0",
      }),
      JSON.stringify({
        kind: "run_request",
        protocolVersion: "1.0.0",
        job: {
          id: "ba0688bb-cfd1-455f-84d4-1238d18d9967",
          attemptId: "d39ff38f-c09e-4afd-81f0-efa50e9f267d",
        },
        case: {
          id: "typescript-clamp-bounds",
          benchmarkId: "repository-repair",
          benchmarkVersion: "1.0.0",
        },
        prompt: "Repair clamp.",
        workspace: { root: workspace },
        toolset: {
          id: "builtin",
          version: "1.0.0",
          tools: ["apply_patch"],
          mcpProfiles: [],
        },
        limits: {
          maxDurationMs: 30_000,
          maxToolCalls: 10,
          maxTokens: 10_000,
          maxTurns: 10,
        },
        checkpoint: null,
      }),
      "",
    ].join("\n");

    const result = await execute(executable, input, {
      OPENAI_API_KEY: ambientSecret,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(ambientSecret);
    const transcript = result.stdout.trim().split("\n").map(decodeProtocolLine);
    expect(transcript.at(-1)).toMatchObject({
      kind: "run_result",
      status: "completed",
      metadata: { credentialGrants: [] },
    });
    expect(await readFile(join(workspace, "src/clamp.cjs"), "utf8")).toContain(
      "if (value > upper) return upper;",
    );
  });
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), `llm-bench-example-plugin-${label}-`),
  );
  roots.push(root);
  return root;
}

function execute(
  executable: string,
  input: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
