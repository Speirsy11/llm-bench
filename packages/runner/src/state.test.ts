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
  const rawKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const runnerId = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";

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
      runnerId,
      token: "runner-token",
      publicKey: rawKey,
      privateKey: rawKey,
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

  it("rejects invalid credentials before persisting them", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));

    await expect(
      store.saveCredentials({
        serverUrl: "https://bench.example",
        runnerId: "not-a-runner-uuid",
        token: "runner-token",
        publicKey: rawKey,
        privateKey: rawKey,
      }),
    ).rejects.toThrow();
    await expect(store.credentials()).resolves.toBeNull();
  });

  it("rejects legacy DER key state with actionable re-login guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));
    await store.ensureRoot();
    await writeFile(
      join(root, "state", "credentials.json"),
      `${JSON.stringify({
        serverUrl: "https://bench.example",
        runnerId,
        token: "runner-token",
        publicKey: Buffer.alloc(44).toString("base64"),
        privateKey: Buffer.alloc(48).toString("base64"),
      })}\n`,
    );

    await expect(store.credentials()).rejects.toThrow(
      "remove it and run login/start again",
    );
  });

  it("replaces private state files atomically without leaving temp files", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-bench-runner-"));
    roots.push(root);
    const store = new RunnerStateStore(join(root, "state"));
    const credentials = {
      serverUrl: "https://bench.example",
      runnerId,
      token: "runner-token",
      publicKey: rawKey,
      privateKey: rawKey,
    };

    await store.saveCredentials(credentials);

    expect(
      await readFile(join(root, "state", "credentials.json"), "utf8"),
    ).toBe(`${JSON.stringify(credentials)}\n`);
  });
});
