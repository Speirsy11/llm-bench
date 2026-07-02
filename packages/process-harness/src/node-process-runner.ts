import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "./types";
import { ProcessOutputLimitError } from "./errors";

export class NodeProcessRunner implements ProcessRunner {
  constructor(private readonly options: { killGraceMs?: number } = {}) {}

  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    return new Promise((resolve, reject) => {
      const [command, ...args] = request.argv;
      const child = spawn(command, args, {
        cwd: request.cwd,
        env: request.env,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let cancelled = request.signal?.aborted === true;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const redact = (value: string): string => {
        let safe = value;
        for (const secret of request.redact ?? []) {
          if (secret.length > 0) safe = safe.replaceAll(secret, "[REDACTED]");
        }
        return safe;
      };

      const terminate = (): void => {
        cancelled = true;
        terminateProcessGroup(child, "SIGTERM");
        if (killTimer === null) {
          killTimer = setTimeout(() => {
            terminateProcessGroup(child, "SIGKILL");
          }, this.options.killGraceMs ?? 250);
          killTimer.unref();
        }
      };
      const onAbort = (): void => terminate();
      request.signal?.addEventListener("abort", onAbort, { once: true });

      const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > request.maxOutputBytes) {
          terminate();
          if (!settled) {
            settled = true;
            reject(new ProcessOutputLimitError(request.maxOutputBytes));
          }
          return;
        }
        const value = chunk.toString("utf8");
        if (target === "stdout") stdout += value;
        else stderr += value;
      };

      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          const sanitizedCause = new Error(redact(error.message));
          sanitizedCause.name = error.name;
          reject(new Error(redact(error.message), { cause: sanitizedCause }));
        }
      });
      child.on("close", (exitCode, signal) => {
        if (killTimer !== null) clearTimeout(killTimer);
        request.signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve({
          exitCode,
          signal,
          stdoutLines: redact(stdout)
            .split(/\r?\n/u)
            .filter((line) => line.length > 0),
          stderr: redact(stderr),
          outputBytes,
          cancelled,
        });
      });

      if (request.stdin === undefined) child.stdin.end();
      else child.stdin.end(request.stdin);
      if (cancelled) terminate();
    });
  }
}

export function terminateProcessGroup(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
  kill: typeof process.kill = (pid, signal) => process.kill(pid, signal),
): void {
  if (child.pid !== undefined) {
    try {
      kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the state check and the group signal.
    }
  }
  child.kill(signal);
}
