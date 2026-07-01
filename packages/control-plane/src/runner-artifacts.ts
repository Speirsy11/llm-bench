const MAX_RUNNER_ARTIFACT_BYTES = 10 * 1024 * 1024;

export function validateRunnerArtifactUpload(input: {
  attemptId: string;
  pathname: string;
  contentHash: string;
  byteLength: number;
}): { maximumSizeInBytes: number } {
  const expectedPath = `attempts/${input.attemptId}/${input.contentHash}.patch`;
  if (
    !/^[a-f0-9]{64}$/.test(input.contentHash) ||
    input.pathname !== expectedPath ||
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength < 0 ||
    input.byteLength > MAX_RUNNER_ARTIFACT_BYTES
  ) {
    throw new Error("Artifact upload is invalid.");
  }
  return { maximumSizeInBytes: input.byteLength };
}
