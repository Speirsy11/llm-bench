const MAX_RUNNER_ARTIFACT_BYTES = 10 * 1024 * 1024;

export function validateRunnerArtifactUpload(input: {
  attemptId: string;
  pathname: string;
  contentHash: string;
  byteLength: number;
}): { maximumSizeInBytes: number } {
  const expectedPaths = new Set([
    `attempts/${input.attemptId}/${input.contentHash}.patch`,
    `attempts/${input.attemptId}/${input.contentHash}.json`,
  ]);
  if (
    !/^[a-f0-9]{64}$/.test(input.contentHash) ||
    !expectedPaths.has(input.pathname) ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 0 ||
    input.byteLength > MAX_RUNNER_ARTIFACT_BYTES
  ) {
    throw new Error("Artifact upload is invalid.");
  }
  return { maximumSizeInBytes: input.byteLength };
}
