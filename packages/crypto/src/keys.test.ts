import { describe, expect, it } from "vitest";

import { fingerprintPublicKey, generateRunnerKeyPair } from "./keys";

describe("runner keys", () => {
  it("generates distinct base64 X25519 key pairs", async () => {
    const a = await generateRunnerKeyPair();
    const b = await generateRunnerKeyPair();

    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
    // 32 raw bytes → base64 without padding-only content.
    expect(Buffer.from(a.publicKey, "base64")).toHaveLength(32);
    expect(Buffer.from(a.privateKey, "base64")).toHaveLength(32);
  });

  it("fingerprints a public key deterministically", async () => {
    const { publicKey } = await generateRunnerKeyPair();
    const first = await fingerprintPublicKey(publicKey);
    const second = await fingerprintPublicKey(publicKey);
    expect(first).toBe(second);

    const other = await generateRunnerKeyPair();
    expect(await fingerprintPublicKey(other.publicKey)).not.toBe(first);
  });
});
