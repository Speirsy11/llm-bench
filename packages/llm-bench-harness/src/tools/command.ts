import { execFile } from "node:child_process";

import type { AgentTool, ToolContext } from "../types";
import { ToolInputError } from "./repository";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs a fixed binary within the repository root. Injectable for tests. */
export type CommandExecutor = (
  command: string,
  args: string[],
  context: { cwd: string; signal: AbortSignal },
) => Promise<CommandResult>;

export interface CommandToolSpec {
  /** Tool name exposed to the model. */
  name: string;
  description: string;
  /** Fixed executable defined by the task; never chosen by the model. */
  command: string;
  /** Fixed leading arguments. */
  args?: string[];
  /** When true, the model may append its own string arguments. */
  allowExtraArgs?: boolean;
  /** Maximum captured output characters. */
  maxOutputChars?: number;
}

/**
 * Creates a task-defined command tool. The task owns the executable and its
 * base arguments; the model can only append arguments when explicitly allowed.
 */
export function createCommandTool(
  spec: CommandToolSpec,
  executor: CommandExecutor = defaultExecutor,
): AgentTool {
  const baseArgs = spec.args ?? [];
  const maxOutput = spec.maxOutputChars ?? 8 * 1024;
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: "object",
        properties: spec.allowExtraArgs
          ? { args: { type: "array", items: { type: "string" } } }
          : {},
      },
    },
    async execute(rawArguments, context: ToolContext) {
      const extraArgs = parseExtraArgs(
        rawArguments,
        spec.allowExtraArgs ?? false,
      );
      const result = await executor(spec.command, [...baseArgs, ...extraArgs], {
        cwd: context.root,
        signal: context.signal,
      });
      const body = `${result.stdout}${result.stderr}`.slice(0, maxOutput);
      return `exit ${result.exitCode}\n${body}`;
    },
  };
}

function parseExtraArgs(
  rawArguments: string,
  allowExtraArgs: boolean,
): string[] {
  if (rawArguments === "" || rawArguments === "{}") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new ToolInputError("Tool arguments were not valid JSON.");
  }
  const args = (parsed as { args?: unknown }).args;
  if (args === undefined) return [];
  if (!allowExtraArgs) {
    throw new ToolInputError("This command does not accept arguments.");
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new ToolInputError("`args` must be an array of strings.");
  }
  return args as string[];
}

const defaultExecutor: CommandExecutor = (command, args, context) =>
  new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      { cwd: context.cwd, signal: context.signal, shell: false },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolvePromise({ stdout, stderr, exitCode });
      },
    );
  });
