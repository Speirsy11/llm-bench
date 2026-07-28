export interface ProcessRunRequest {
  argv: [string, ...string[]];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal?: AbortSignal;
  maxOutputBytes: number;
  redact?: readonly string[];
  /** Preserve structured stdout for a caller that redacts after decoding. */
  redactStdout?: boolean;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
  outputBytes: number;
  cancelled: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}
