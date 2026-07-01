import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

export function runnerHome(
  environment: Readonly<Record<string, string | undefined>> = env,
): string {
  return environment.LLMBENCH_RUNNER_HOME ?? join(homedir(), ".llm-bench");
}
