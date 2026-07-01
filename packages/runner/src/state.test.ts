import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RunnerStateStore } from "./state";

describe("RunnerStateStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("persists credentials and key material with restrictive permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));
    const credentials = {
      serverUrl: "https://bench.example",
      runnerId: "runner-1",
      token: "runner-token",
      publicKey: "public-key",
      privateKey: "private-key",
    };

    await store.saveCredentials(credentials);

    expect(await store.credentials()).toEqual(credentials);
    expect((await stat(join(root, "state"))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(root, "state", "credentials.json"))).mode & 0o777,
    ).toBe(0o600);
    await store.clearCredentials();
    await expect(store.credentials()).resolves.toBeNull();
  });

  it("surfaces non-missing filesystem read failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    await mkdir(join(root, "state", "credentials.json"), { recursive: true });
    const store = new RunnerStateStore(join(root, "state"));

    await expect(store.credentials()).rejects.toThrow();
    await mkdir(join(root, "state", "active-job.json"), { recursive: true });
    await expect(store.activeJob()).rejects.toThrow();
  });

  it("rejects malformed private state with an actionable error", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));
    await store.ensureRoot();
    await writeFile(join(root, "state", "credentials.json"), "{}\n");

    await expect(store.credentials()).rejects.toThrow(
      "Runner state file credentials.json is invalid",
    );
  });

  it("replaces private state files atomically without leaving temp files", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));
    const credentials = {
      serverUrl: "https://bench.example",
      runnerId: "runner-1",
      token: "runner-token",
      publicKey: "public-key",
      privateKey: "private-key",
    };

    await store.saveCredentials(credentials);

    expect(
      await readFile(join(root, "state", "credentials.json"), "utf8"),
    ).toBe(`${JSON.stringify(credentials)}\n`);
  });
});
