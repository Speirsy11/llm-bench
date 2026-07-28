import { describe, expect, it } from "vitest";

import type { RunnerIdentity, SealedCredential } from "./types";
import { fingerprintPublicKey, generateRunnerKeyPair } from "./keys";
import { REDACTION_MARKER, Secret } from "./redaction";
import { sealCredential } from "./seal";
import { openCredential, SealedCredentialError } from "./sealed-box";
import { getSodium } from "./sodium";
import { SEALED_BOX_ALGORITHM } from "./types";

async function makeRunner(runnerId: string): Promise<RunnerIdentity> {
  const keyPair = await generateRunnerKeyPair();
  return { runnerId, ...keyPair };
}

/** Seals arbitrary plaintext directly to a public key, bypassing the envelope. */
async function sealRaw(publicKey: string, plaintext: string): Promise<string> {
  const sodium = await getSodium();
  const box = sodium.crypto_box_seal(
    sodium.from_string(plaintext),
    sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL),
  );
  return sodium.to_base64(box, sodium.base64_variants.ORIGINAL);
}

async function envelope(
  runner: RunnerIdentity,
  ciphertext: string,
): Promise<SealedCredential> {
  return {
    algorithm: SEALED_BOX_ALGORITHM,
    runnerId: runner.runnerId,
    keyFingerprint: await fingerprintPublicKey(runner.publicKey),
    ciphertext,
  };
}

const OPENROUTER_KEY = "sk-or-canary-3f9c-not-a-real-key";
const RUNNER_A_ID = "70b70847-ec1c-4aeb-ac0f-bf7db0328efe";
const RUNNER_B_ID = "d0da824f-6f6a-4a01-af27-f7448d22bb39";

describe("sealed credentials", () => {
  it("RED→GREEN: only the selected runner decrypts a credential", async () => {
    const runnerA = await makeRunner(RUNNER_A_ID);

    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: OPENROUTER_KEY,
    });

    expect(sealed.algorithm).toBe(SEALED_BOX_ALGORITHM);
    expect(sealed.ciphertext).not.toContain("canary");

    const opened = await openCredential(sealed, runnerA);
    expect(opened.reveal()).toBe(OPENROUTER_KEY);
  });

  it("denies a different runner even when its id is spoofed", async () => {
    const runnerA = await makeRunner(RUNNER_A_ID);
    const runnerB = await makeRunner(RUNNER_B_ID);

    const sealed = await sealCredential({
      runnerId: runnerA.runnerId,
      recipientPublicKey: runnerA.publicKey,
      secret: OPENROUTER_KEY,
    });

    await expect(openCredential(sealed, runnerB)).rejects.toMatchObject({
      reason: "wrong-runner",
    });

    const spoofed = { ...sealed, runnerId: runnerB.runnerId };
    await expect(openCredential(spoofed, runnerB)).rejects.toMatchObject({
      reason: "wrong-key",
    });
  });

  it("fails closed when the key pair does not match the fingerprint", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    const other = await generateRunnerKeyPair();
    const sealed = await sealCredential({
      runnerId: runner.runnerId,
      recipientPublicKey: runner.publicKey,
      secret: OPENROUTER_KEY,
    });

    const wrongKey: RunnerIdentity = { runnerId: runner.runnerId, ...other };
    await expect(openCredential(sealed, wrongKey)).rejects.toMatchObject({
      reason: "wrong-key",
    });
  });

  it("detects ciphertext tampering", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    const sealed = await sealCredential({
      runnerId: runner.runnerId,
      recipientPublicKey: runner.publicKey,
      secret: OPENROUTER_KEY,
    });

    const bytes = Buffer.from(sealed.ciphertext, "base64");
    const lastByte = bytes.at(-1);
    if (lastByte === undefined) throw new Error("ciphertext was empty");
    bytes[bytes.length - 1] = lastByte ^ 0x01;
    const tampered = { ...sealed, ciphertext: bytes.toString("base64") };

    await expect(openCredential(tampered, runner)).rejects.toMatchObject({
      reason: "tampered",
    });
  });

  it("rejects an unsupported algorithm", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    const sealed = await sealCredential({
      runnerId: runner.runnerId,
      recipientPublicKey: runner.publicKey,
      secret: OPENROUTER_KEY,
    });

    const foreign = { ...sealed, algorithm: "aes-256-gcm" as never };
    await expect(openCredential(foreign, runner)).rejects.toBeInstanceOf(
      SealedCredentialError,
    );
    await expect(openCredential(foreign, runner)).rejects.toMatchObject({
      reason: "unsupported-algorithm",
    });
  });

  it("rejects a mismatched inner runner binding", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    const ciphertext = await sealRaw(
      runner.publicKey,
      JSON.stringify({
        v: 1,
        runnerId: RUNNER_B_ID,
        secret: OPENROUTER_KEY,
      }),
    );
    await expect(
      openCredential(await envelope(runner, ciphertext), runner),
    ).rejects.toMatchObject({ reason: "tampered" });
  });

  it("rejects malformed decrypted payloads", async () => {
    const runner = await makeRunner(RUNNER_A_ID);

    const notJson = await envelope(
      runner,
      await sealRaw(runner.publicKey, "nope"),
    );
    await expect(openCredential(notJson, runner)).rejects.toMatchObject({
      reason: "tampered",
    });

    for (const payload of [
      { v: 2, runnerId: runner.runnerId, secret: "x" },
      "string-payload",
      null,
      { v: 1, runnerId: 42, secret: "x" },
      { v: 1, runnerId: runner.runnerId, secret: 42 },
    ]) {
      const malformed = await envelope(
        runner,
        await sealRaw(runner.publicKey, JSON.stringify(payload)),
      );
      await expect(openCredential(malformed, runner)).rejects.toMatchObject({
        reason: "tampered",
      });
    }
  });

  it("rejects malformed seal inputs before using key material", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    await expect(
      sealCredential({
        runnerId: "runner-a",
        recipientPublicKey: runner.publicKey,
        secret: OPENROUTER_KEY,
      }),
    ).rejects.toThrow();
    await expect(
      sealCredential({
        runnerId: RUNNER_A_ID,
        recipientPublicKey: Buffer.alloc(44).toString("base64"),
        secret: OPENROUTER_KEY,
      }),
    ).rejects.toThrow(/raw 32-byte/);
    await expect(
      sealCredential({
        runnerId: RUNNER_A_ID,
        recipientPublicKey: runner.publicKey,
        secret: "",
      }),
    ).rejects.toThrow(/empty credential/);
  });

  it("rejects malformed envelope metadata before opening", async () => {
    const runner = await makeRunner(RUNNER_A_ID);
    const sealed = await sealCredential({
      runnerId: RUNNER_A_ID,
      recipientPublicKey: runner.publicKey,
      secret: OPENROUTER_KEY,
    });

    await expect(
      openCredential({ ...sealed, ciphertext: "not-base64" }, runner),
    ).rejects.toMatchObject({ reason: "tampered" });
  });

  it("keeps the resolved secret out of serialised output", () => {
    const secret = new Secret(OPENROUTER_KEY);
    expect(String(secret)).toBe(REDACTION_MARKER);
    expect(JSON.stringify({ apiKey: secret })).toBe(
      `{"apiKey":"${REDACTION_MARKER}"}`,
    );
    expect(String(secret)).not.toContain("canary");
    expect(secret.reveal()).toBe(OPENROUTER_KEY);
  });
});
