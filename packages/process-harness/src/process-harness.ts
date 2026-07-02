import type {
  AdapterRunRequest,
  AdapterRunResult,
  HarnessManifest,
} from "@llm-bench/contracts";
import { ProcessHarnessAdapter } from "@llm-bench/contracts";

import type { ProcessRunner, ProcessRunResult } from "./types";
import { cleanProcessEnvironment } from "./environment";
import { MalformedProcessEventError } from "./errors";
import { NodeProcessRunner } from "./node-process-runner";

export interface JsonlProcessHarnessOptions {
  runner?: ProcessRunner;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  redact?: readonly string[];
}

/**
 * Reusable process-harness boundary: a clean environment, bounded process
 * output, prompt delivery over stdin, cancellation, and JSONL event parsing.
 */
export abstract class JsonlProcessHarnessAdapter<
  NativeEvent,
> extends ProcessHarnessAdapter {
  protected constructor(
    manifest: HarnessManifest,
    protected readonly processOptions: JsonlProcessHarnessOptions = {},
  ) {
    super(manifest);
  }

  override async run(request: AdapterRunRequest): Promise<AdapterRunResult> {
    const command = this.command(request);
    const executable = command[0];
    if (executable === undefined) throw new Error("Process command is empty.");
    const deadline = AbortSignal.timeout(request.limits.maxDurationMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, deadline])
      : deadline;
    const processResult = await (
      this.processOptions.runner ?? new NodeProcessRunner()
    ).run({
      argv: [executable, ...command.slice(1)],
      cwd: request.workspaceRoot,
      env: cleanProcessEnvironment(process.env, this.processOptions.env),
      stdin: request.prompt,
      signal,
      maxOutputBytes: this.processOptions.maxOutputBytes ?? 10 * 1024 * 1024,
      redact: this.processOptions.redact,
    });
    const events = processResult.stdoutLines.map((line, index) => {
      try {
        return this.parseEvent(line);
      } catch (error) {
        throw new MalformedProcessEventError(index + 1, {
          cause: error,
        });
      }
    });
    return this.complete(request, events, processResult);
  }

  protected abstract parseEvent(line: string): NativeEvent;

  protected abstract complete(
    request: AdapterRunRequest,
    events: NativeEvent[],
    process: ProcessRunResult,
  ): AdapterRunResult;
}
