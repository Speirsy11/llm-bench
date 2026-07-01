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
    input.byteLength < 0
  ) {
    throw new Error("Artifact upload is invalid.");
  }
  return { maximumSizeInBytes: input.byteLength };
}
