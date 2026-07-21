import { parseWebEnv } from "@/env";

import {
  createDatabase,
  createRunnerHttpHandler,
  createRunnerJobService,
  createRunnerProtocolService,
  PostgresRunnerJobStore,
  PostgresRunnerProtocolStore,
  validateRunnerArtifactUpload,
} from "@llm-bench/control-plane";

const env = parseWebEnv(process.env);
const database = createDatabase(env.databaseUrl);

export const runnerProtocol = createRunnerProtocolService({
  store: new PostgresRunnerProtocolStore(database.db),
});

const runnerJobs = createRunnerJobService({
  store: new PostgresRunnerJobStore(database.db),
});

export async function authorizeRunnerBlobUpload(input: {
  runnerToken: string;
  attemptId: string;
  leaseToken: string;
  pathname: string;
  contentHash: string;
  byteLength: number;
}) {
  const runner = await runnerProtocol.authenticate(input.runnerToken);
  await runnerJobs.authorizeArtifactUpload(runner, input);
  return {
    runnerId: runner.id,
    ...validateRunnerArtifactUpload(input),
  };
}

export function handleRunnerRequest(
  request: Request,
  path: string[],
): Promise<Response> {
  const baseUrl = new URL(request.url).origin;
  return createRunnerHttpHandler({
    protocol: runnerProtocol,
    jobs: runnerJobs,
    baseUrl,
  })(request, path);
}
