import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { VercelBlobUploader } from "./blob-uploader";
import { runnerLeaseFixture } from "./test-fixture";

const lease = runnerLeaseFixture();

describe("VercelBlobUploader", () => {
  it("uploads private artifacts directly with lease-scoped client payload", async () => {
    const uploads: { path: string; options: Record<string, unknown> }[] = [];
    const bytes = Buffer.from("patch");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const uploader = new VercelBlobUploader(
      {
        serverUrl: "https://bench.example/",
        runnerId: "runner-1",
        token: "runner-token",
        publicKey: "public-key",
        privateKey: "private-key",
      },
      "/private/artifacts",
      {
        readFile: (() => Promise.resolve(bytes)) as never,
        upload: ((
          path: string,
          _bytes: unknown,
          options: Record<string, unknown>,
        ) => {
          uploads.push({ path, options });
          return Promise.resolve({});
        }) as never,
      },
    );

    await uploader.upload(lease, {
      kind: "diff",
      blobPath: `attempts/${lease.attemptId}/diff.patch`,
      contentHash,
      byteLength: 5,
    });

    expect(uploads[0]).toMatchObject({
      path: `attempts/${lease.attemptId}/diff.patch`,
      options: {
        access: "private",
        handleUploadUrl: "https://bench.example/api/v1/runner/artifacts/upload",
        multipart: false,
      },
    });
    expect(uploads[0]?.options.clientPayload).toContain("runner-token");
  });

  it("refuses to upload bytes that do not match the artifact hash", async () => {
    const uploader = new VercelBlobUploader(
      {
        serverUrl: "https://bench.example/",
        runnerId: "runner-1",
        token: "runner-token",
        publicKey: "public-key",
        privateKey: "private-key",
      },
      "/private/artifacts",
      {
        readFile: (() => Promise.resolve(Buffer.from("corrupt"))) as never,
        upload: (() => Promise.resolve({})) as never,
      },
    );

    await expect(
      uploader.upload(lease, {
        kind: "diff",
        blobPath: `attempts/${lease.attemptId}/diff.patch`,
        contentHash: "a".repeat(64),
        byteLength: 7,
      }),
    ).rejects.toThrow("Artifact content hash mismatch.");
  });
});
