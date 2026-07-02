export class ProcessOutputLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Process output exceeded ${limitBytes} bytes.`);
    this.name = "ProcessOutputLimitError";
  }
}

export class ProcessExitError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
  ) {
    super(
      exitCode === null
        ? `Process terminated by ${signal ?? "an unknown signal"}.`
        : `Process exited with code ${exitCode}.${
            stderr.trim().length > 0 ? ` ${stderr.trim()}` : ""
          }`,
    );
    this.name = "ProcessExitError";
  }
}

export class MalformedProcessEventError extends Error {
  constructor(
    readonly lineNumber: number,
    options: ErrorOptions,
  ) {
    super(`Invalid JSONL event at line ${lineNumber}.`, options);
    this.name = "MalformedProcessEventError";
  }
}
