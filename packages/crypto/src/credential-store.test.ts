import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RunnerCredentialStore } from "./credential-store";
import { generateRunnerKeyPair } from "./keys";
import { sealCredential } from "./sealed-box";
import { SEALED_BOX_ALGORITHM } from "./types";

const roots: string[] = [];

async function newStore(): Promise<RunnerCredentialStore> {
  const root = await mkdtemp(join(tmpdir(), "llm-bench-cred-"));
  roots.push(root);
  return new RunnerCredentialStore(join(root, "store"));
}

afterEach(() => {
  roots.length = 0;
});

describe("RunnerCredentialStore", () => {
  it("persists a key pair with private permissions", async () => {
    const store = await newStore();
    const keyPair = await generateRunnerKeyPair();
    await store.saveKeyPair(keyPair);

    expect(await store.keyPair()).toEqual(keyPair);

    const dirMode = (await stat(store.root)).mode & 0o777;
    const fileMode =
      (await stat(join(store.root, "runner-key.json"))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("returns null when no key pair or credential is stored", async () => {
    const store = await newStore();
    expect(await store.keyPair()).toBeNull();
    expect(await store.sealedCredential("openrouter")).toBeNull();
  });

  it("rejects an incomplete key pair", async () => {
    const store = await newStore();
    await expect(
      store.saveKeyPair({ publicKey: "", privateKey: "x" }),
    ).rejects.toThrow(/incomplete/);
  });

  it("round-trips a sealed credential without exposing plaintext", async () => {
    const store = await newStore();
    const runner = await generateRunnerKeyPair();
    const sealed = await sealCredential({
      runnerId: "runner-a",
      recipientPublicKey: runner.publicKey,
      secret: "sk-or-canary-key",
    });

    await store.saveSealedCredential("openrouter", sealed);
    expect(await store.sealedCredential("openrouter")).toEqual(sealed);

    const onDisk = await readFile(
      join(store.root, "credential-openrouter.json"),
      "utf8",
    );
    expect(onDisk).not.toContain("canary");
  });

  it("deletes a sealed credential", async () => {
    const store = await newStore();
    const runner = await generateRunnerKeyPair();
    const sealed = await sealCredential({
      runnerId: "runner-a",
      recipientPublicKey: runner.publicKey,
      secret: "sk-or-canary-key",
    });
    await store.saveSealedCredential("openrouter", sealed);
    await store.deleteSealedCredential("openrouter");
    expect(await store.sealedCredential("openrouter")).toBeNull();
  });

  it("refuses to store an unknown algorithm", async () => {
    const store = await newStore();
    await expect(
      store.saveSealedCredential("openrouter", {
        algorithm: "rot13" as never,
        runnerId: "runner-a",
        keyFingerprint: "fp",
        ciphertext: "x",
      }),
    ).rejects.toThrow(/unknown algorithm/);
  });

  it("rejects unsafe credential names", async () => {
    const store = await newStore();
    await expect(store.sealedCredential("../escape")).rejects.toThrow(
      /Invalid credential name/,
    );
  });

  it("reports a malformed key pair file", async () => {
    const store = await newStore();
    await store.ensureRoot();
    await writeFile(join(store.root, "runner-key.json"), '{"publicKey":1}\n');
    await expect(store.keyPair()).rejects.toThrow(/malformed/);
  });

  it("propagates unexpected filesystem errors", async () => {
    const store = await newStore();
    await store.ensureRoot();
    // A directory in place of the key file surfaces EISDIR, not ENOENT.
    await mkdir(join(store.root, "runner-key.json"));
    await expect(store.keyPair()).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("reports a malformed sealed credential file", async () => {
    const store = await newStore();
    await store.ensureRoot();
    await writeFile(
      join(store.root, "credential-openrouter.json"),
      JSON.stringify({ algorithm: SEALED_BOX_ALGORITHM, runnerId: "a" }) + "\n",
    );
    await expect(store.sealedCredential("openrouter")).rejects.toThrow(
      /malformed/,
    );
  });
});
