import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactSchema } from "@llm-bench/contracts";

import { FileArtifactStore } from "./artifact-store";

describe("FileArtifactStore", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function store(): Promise<FileArtifactStore> {
    const dir = await mkdtemp(path.join(tmpdir(), "artifacts-"));
    dirs.push(dir);
    return new FileArtifactStore(dir);
  }

  it("returns a contract-valid artifact addressed by sha256 content hash", async () => {
    const artifactStore = await store();
    const bytes = Buffer.from("hello diff", "utf8");

    const artifact = await artifactStore.put({
      jobId: "job-1",
      mediaType: "text/plain",
      bytes,
    });

    // Expected hash computed independently of the production helper.
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(ArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(artifact.contentHash).toBe(expected);
    expect(artifact.byteSize).toBe(10);
    expect(artifact.jobId).toBe("job-1");
    expect(artifact.mediaType).toBe("text/plain");
  });

  it("persists the stored bytes so they can be retrieved later", async () => {
    const artifactStore = await store();
    const bytes = Buffer.from("payload", "utf8");

    const artifact = await artifactStore.put({
      jobId: "job-2",
      mediaType: "application/json",
      bytes,
    });

    expect(await readFile(artifactStore.locate(artifact))).toEqual(bytes);
    expect((await stat(artifactStore.locate(artifact))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("gives identical content the same id and distinct content different ids", async () => {
    const artifactStore = await store();

    const a = await artifactStore.put({
      jobId: "j",
      mediaType: "text/plain",
      bytes: Buffer.from("same"),
    });
    const b = await artifactStore.put({
      jobId: "j",
      mediaType: "text/plain",
      bytes: Buffer.from("same"),
    });
    const c = await artifactStore.put({
      jobId: "j",
      mediaType: "text/plain",
      bytes: Buffer.from("different"),
    });

    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });
});
