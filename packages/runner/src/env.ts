import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

export function runnerHome(
  environment: Readonly<Record<string, string | undefined>> = env,
): string {
  const configured = environment.LLMBENCH_RUNNER_HOME?.trim();
  if (configured) return configured;
  return join(homedir(), ".llm-bench");
}
