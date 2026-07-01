import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { upload } from "@vercel/blob/client";

import type {
  RunnerArtifactReference,
  RunnerLease,
} from "@llm-bench/contracts";

import type { RunnerCredentials } from "./state";
import type { RunnerArtifactUploader } from "./worker";

export class VercelBlobUploader implements RunnerArtifactUploader {
  constructor(
    private readonly credentials: RunnerCredentials,
    private readonly artifactRoot: string,
    private readonly dependencies: {
      readFile: typeof readFile;
      upload: typeof upload;
    } = { readFile, upload },
  ) {}

  async upload(
    lease: RunnerLease,
    artifact: RunnerArtifactReference,
  ): Promise<void> {
    const bytes = await this.dependencies.readFile(
      join(this.artifactRoot, artifact.contentHash),
    );
    await this.dependencies.upload(artifact.blobPath, bytes, {
      access: "private",
      handleUploadUrl: `${this.credentials.serverUrl.replace(/\/$/, "")}/api/v1/runner/artifacts/upload`,
      clientPayload: JSON.stringify({
        runnerToken: this.credentials.token,
        attemptId: lease.attemptId,
        leaseToken: lease.leaseToken,
        contentHash: artifact.contentHash,
        byteLength: artifact.byteLength,
      }),
      multipart: bytes.byteLength > 4 * 1024 * 1024,
    });
  }
}
