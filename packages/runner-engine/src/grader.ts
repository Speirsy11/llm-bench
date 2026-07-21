import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";

import type { Workspace } from "./workspace";

/**
 * A single hidden behavioural test, injected only after the harness has
 * finished. The trusted source runs in a disposable child process whose working
 * directory is the repaired workspace. Completing without an exception passes;
 * an exception, process failure, or missing result counts as a failure.
 *
 * The child boundary protects the long-lived runner from crashes, exits,
 * unbounded output, and lingering descendants. Node graders additionally use
 * the Node permission model and every grader receives a credential-free
 * environment. This is not a hostile-code sandbox: trusted hidden-test source
 * and repaired code share one child, Python has no equivalent permission model,
 * and network denial remains the surrounding runner sandbox's responsibility.
 */
export interface HiddenTest {
  id: string;
  runtime: "node" | "python";
  source: string;
}

export interface GradeResult {
  total: number;
  passed: number;
  ratio: number;
  passedIds: string[];
  failedIds: string[];
}

export interface GradeHiddenTestsOptions {
  maxOutputBytes?: number;
  maxResultBytes?: number;
  signal?: AbortSignal;
  temporaryRoot?: string;
  timeoutMs?: number;
}

class GraderInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraderInfrastructureError";
  }
}

/**
 * Runs hidden tests against the repaired workspace and returns the pass ratio.
 * The ratio is derived purely from the hidden tests, independent of any signal
 * the harness reported about its own success.
 */
export async function gradeHiddenTests(
  workspace: Workspace,
  tests: HiddenTest[],
  options: GradeHiddenTestsOptions = {},
): Promise<GradeResult> {
  const passedIds: string[] = [];
  const failedIds: string[] = [];
  for (const test of tests) {
    const passed = await runIsolated(workspace, test, options).catch(
      (error) => {
        if (error instanceof GraderInfrastructureError) throw error;
        return false;
      },
    );
    (passed ? passedIds : failedIds).push(test.id);
  }
  const total = tests.length;
  const passed = passedIds.length;
  return {
    total,
    passed,
    ratio: total === 0 ? 0 : passed / total,
    passedIds,
    failedIds,
  };
}

async function runIsolated(
  workspace: Workspace,
  test: HiddenTest,
  options: GradeHiddenTestsOptions,
): Promise<boolean> {
  if (options.signal?.aborted) return false;
  const graderRoot = await realpath(
    await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "llm-bench-grader-")),
  );
  const scriptPath = join(graderRoot, "grade.cjs");
  const pythonSupervisorPath = join(graderRoot, "grade.py");
  const pythonWorkerPath = join(graderRoot, "worker.py");
  const executable =
    test.runtime === "node"
      ? process.execPath
      : (process.env.LLMBENCH_PYTHON ?? "python3");
  const arguments_ =
    test.runtime === "node"
      ? [
          "--permission",
          `--allow-fs-read=${workspace.root}`,
          `--allow-fs-read=${graderRoot}`,
          `--allow-fs-write=${workspace.root}`,
          `--allow-fs-write=${graderRoot}`,
          scriptPath,
        ]
      : [
          // The trusted supervisor must resolve stdlib imports independently
          // of model-authored modules in cwd or PYTHONPATH. Its worker adds the
          // workspace to sys.path explicitly after this boundary.
          "-I",
          pythonSupervisorPath,
        ];
  try {
    if (test.runtime === "node") {
      await writeFile(
        scriptPath,
        nodeGraderSource(workspace.root, test.source),
        {
          encoding: "utf8",
          mode: 0o600,
        },
      );
    } else {
      await Promise.all([
        writeFile(
          pythonSupervisorPath,
          pythonSupervisorSource(workspace.root, pythonWorkerPath),
          { encoding: "utf8", mode: 0o600 },
        ),
        writeFile(
          pythonWorkerPath,
          pythonWorkerSource(workspace.root, test.source),
          { encoding: "utf8", mode: 0o600 },
        ),
      ]);
    }
    const authentication = randomBytes(32).toString("base64url");
    const protocol = await runChild(executable, arguments_, workspace.root, {
      authentication,
      env: graderEnvironment(test.runtime, workspace.root),
      maxOutputBytes: options.maxOutputBytes ?? 64 * 1024,
      maxResultBytes: options.maxResultBytes ?? 256,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
    return parseAuthenticatedResult(protocol, authentication);
  } finally {
    await rm(graderRoot, { recursive: true, force: true });
  }
}

function nodeGraderSource(workspaceRoot: string, hiddenSource: string): string {
  return `const assert = require("node:assert/strict");
const path = require("node:path");
const { closeSync, readFileSync, writeSync } = require("node:fs");
const workspaceRoot = ${JSON.stringify(workspaceRoot)};
const trustedResult = Object.freeze({
  closeSync: closeSync.bind(null),
  exit: process.exit.bind(process),
  readFileSync: readFileSync.bind(null),
  removeAllListeners: process.removeAllListeners.bind(process),
  stringify: JSON.stringify.bind(JSON),
  writeSync: writeSync.bind(null),
});
const authentication = trustedResult.readFileSync(4, "utf8");
trustedResult.closeSync(4);

(async () => {
  let passed = false;
  try {
${indent(hiddenSource, 4)}
    passed = true;
  } catch {}
  trustedResult.writeSync(
    3,
    trustedResult.stringify({ authentication, passed }),
    undefined,
    "utf8",
  );
  trustedResult.removeAllListeners("beforeExit");
  trustedResult.removeAllListeners("exit");
  trustedResult.exit(0);
})().catch(() => {
  trustedResult.exit(1);
});
`;
}

function pythonSupervisorSource(
  workspaceRoot: string,
  workerPath: string,
): string {
  return `import json
import os
import subprocess
import sys

def supervise_hidden_test(
    workspace_root=${JSON.stringify(workspaceRoot)},
    worker_path=${JSON.stringify(workerPath)},
    trusted_close=os.close,
    trusted_dumps=json.dumps,
    trusted_exit=os._exit,
    trusted_pipe=os.pipe,
    trusted_read=os.read,
    trusted_run=subprocess.run,
    trusted_write=os.write,
):
    authentication = b""
    while True:
        chunk = trusted_read(4, 1024)
        if not chunk:
            break
        authentication += chunk
    trusted_close(4)
    completion_read, completion_write = trusted_pipe()
    try:
        worker = trusted_run(
            [sys.executable, worker_path, str(completion_write)],
            cwd=workspace_root,
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            pass_fds=(completion_write,),
            check=False,
        )
    finally:
        trusted_close(completion_write)
    completion = trusted_read(completion_read, 2)
    trusted_close(completion_read)
    passed = worker.returncode == 0 and completion == b"1"
    try:
        trusted_write(3, trusted_dumps({
            "authentication": authentication.decode("ascii"),
            "passed": passed,
        }, separators=(",", ":")).encode("utf-8"))
    except BaseException:
        trusted_exit(1)
    trusted_exit(0)

supervise_hidden_test()
`;
}

function pythonWorkerSource(
  workspaceRoot: string,
  hiddenSource: string,
): string {
  return `import os
import sys
from pathlib import Path

# Authentication and the accepted result descriptor intentionally never enter
# this process. The supervisor remains the sole result authority and requires
# this wrapper to reach completion after the hidden source returns. This is
# process isolation, not a hostile-code sandbox: generic in-band spoof
# resistance still needs stronger OS isolation or a structured RPC contract.
completion_fd = int(sys.argv[1])
os.chdir(${JSON.stringify(workspaceRoot)})
sys.path.insert(0, ${JSON.stringify(workspaceRoot)})
try:
${indent(hiddenSource, 4)}
except BaseException:
    os._exit(1)
os.write(completion_fd, b"1")
os.close(completion_fd)
os._exit(0)
`;
}

function runChild(
  executable: string,
  arguments_: string[],
  cwd: string,
  options: {
    authentication: string;
    env: NodeJS.ProcessEnv;
    maxOutputBytes: number;
    maxResultBytes: number;
    signal?: AbortSignal;
    timeoutMs: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      detached: true,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    let outputBytes = 0;
    let resultBytes = 0;
    const resultChunks: Buffer[] = [];
    let failure: Error | null = null;
    const timeout = setTimeout(() => {
      if (failure === null) {
        failure = new Error("Hidden grader timed out.");
        terminateProcessGroup(child);
      }
    }, options.timeoutMs);
    const cancel = () => {
      if (failure === null) {
        failure = new Error("Hidden grader cancelled.");
        terminateProcessGroup(child);
      }
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    const countOutput = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes && failure === null) {
        failure = new Error("Hidden grader output limit exceeded.");
        terminateProcessGroup(child);
      }
    };
    child.stdout?.on("data", countOutput);
    child.stderr?.on("data", countOutput);
    const resultOutput = child.stdio[3] as Readable;
    const authenticationInput = child.stdio[4] as Writable;
    authenticationInput.on("error", () => {
      // A child that exits before reading the authentication cannot produce an
      // accepted result, so a closed input pipe needs no separate signal.
    });
    authenticationInput.end(options.authentication);
    resultOutput.on("data", (chunk: Buffer) => {
      resultBytes += chunk.byteLength;
      if (resultBytes > options.maxResultBytes && failure === null) {
        failure = new Error("Hidden grader result exceeded its size limit.");
        terminateProcessGroup(child);
        return;
      }
      resultChunks.push(chunk);
    });
    child.once("error", (error) => {
      failure = new GraderInfrastructureError(
        `Hidden grader runtime could not start: ${error.message}`,
        { cause: error },
      );
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      terminateProcessGroup(child);
      if (failure) reject(failure);
      else if (code === 0) {
        resolve(Buffer.concat(resultChunks).toString("utf8"));
      } else
        reject(new Error(`Hidden grader exited with code ${String(code)}.`));
    });
    if (options.signal?.aborted) cancel();
  });
}

function parseAuthenticatedResult(
  protocol: string,
  authentication: string,
): boolean {
  return z
    .object({
      authentication: z.literal(authentication),
      passed: z.boolean(),
    })
    .strict()
    .parse(JSON.parse(protocol)).passed;
}

function terminateProcessGroup(child: {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}): void {
  try {
    // Termination is only requested after a successfully spawned child emits
    // output or while its timer/signal is active, so it has a process id.
    process.kill(-Number(child.pid), "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function graderEnvironment(
  runtime: HiddenTest["runtime"],
  workspaceRoot: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C",
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    TZ: "UTC",
  };
  if (runtime === "python") {
    environment.PYTHONDONTWRITEBYTECODE = "1";
    environment.PYTHONHASHSEED = "0";
    environment.PYTHONNOUSERSITE = "1";
    environment.PYTHONPATH = workspaceRoot;
  }
  return environment;
}

function indent(source: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return source
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
