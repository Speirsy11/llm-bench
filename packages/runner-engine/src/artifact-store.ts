import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Artifact } from "@llm-bench/contracts";

/** A request to persist artifact bytes produced during a job. */
export interface ArtifactPutRequest {
  jobId: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** Stores private job artifacts and returns their content-addressed records. */
export interface ArtifactStore {
  put(request: ArtifactPutRequest): Promise<Artifact>;
}

/**
 * Filesystem-backed artifact store. Each artifact is addressed by the SHA-256
 * hash of its bytes, so identical content de-duplicates and a record's id is a
 * verifiable fingerprint of what was stored.
 */
export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async put(request: ArtifactPutRequest): Promise<Artifact> {
    const contentHash = createHash("sha256")
      .update(request.bytes)
      .digest("hex");
    const artifact: Artifact = {
      id: contentHash,
      jobId: request.jobId,
      contentHash,
      byteSize: request.bytes.byteLength,
      mediaType: request.mediaType,
    };
    const destination = this.locate(artifact);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(destination), 0o700);
    await writeFile(destination, request.bytes, { mode: 0o600 });
    await chmod(destination, 0o600);
    return artifact;
  }

  /** Absolute filesystem path where an artifact's bytes are stored. */
  locate(artifact: Artifact): string {
    return path.join(this.root, artifact.contentHash);
  }
}
