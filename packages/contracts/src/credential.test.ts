import { describe, expect, it } from "vitest";

import {
  CredentialMaskSchema,
  RunnerPublicKeySchema,
  SEALED_CREDENTIAL_ALGORITHM,
  SealedCredentialSchema,
} from "./credential";

const runnerPublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("sealed credential contracts", () => {
  it("accepts only four-character masked credential metadata", () => {
    expect(CredentialMaskSchema.parse("••••7f3a")).toBe("••••7f3a");
    expect(() => CredentialMaskSchema.parse("plain-secret")).toThrow(
      "Credential mask is invalid.",
    );
  });

  it("accepts only canonical raw X25519 public keys", () => {
    expect(RunnerPublicKeySchema.parse(runnerPublicKey)).toBe(runnerPublicKey);
    expect(() =>
      RunnerPublicKeySchema.parse(
        "MCowBQYDK2VuAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      ),
    ).toThrow();
    expect(() =>
      RunnerPublicKeySchema.parse(
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=",
      ),
    ).toThrow();
  });

  it("validates the canonical runner-bound sealed envelope", () => {
    expect(
      SealedCredentialSchema.parse({
        algorithm: SEALED_CREDENTIAL_ALGORITHM,
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
        ciphertext:
          "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQw==",
      }),
    ).toMatchObject({ runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe" });

    expect(() =>
      SealedCredentialSchema.parse({
        algorithm: "x25519-xsalsa20-poly1305-sealed-box",
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
        ciphertext: "Q0ND",
      }),
    ).toThrow();

    expect(() =>
      SealedCredentialSchema.parse({
        algorithm: SEALED_CREDENTIAL_ALGORITHM,
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "Q0ND",
        ciphertext:
          "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0ND",
      }),
    ).toThrow();

    expect(() =>
      SealedCredentialSchema.parse({
        algorithm: SEALED_CREDENTIAL_ALGORITHM,
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
        ciphertext:
          "Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N=",
      }),
    ).toThrow();

    expect(() =>
      SealedCredentialSchema.parse({
        algorithm: SEALED_CREDENTIAL_ALGORITHM,
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
        ciphertext: "not base64!",
      }),
    ).toThrow();

    expect(() =>
      SealedCredentialSchema.parse({
        algorithm: SEALED_CREDENTIAL_ALGORITHM,
        runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
        keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
        ciphertext: "A".repeat(8_196),
      }),
    ).toThrow();
  });

  it("rejects Base64 aliases with non-zero unused pad bits", () => {
    const base = {
      algorithm: SEALED_CREDENTIAL_ALGORITHM,
      runnerId: "70b70847-ec1c-4aeb-ac0f-bf7db0328efe",
      keyFingerprint: "BBBBBBBBBBBBBBBBBBBBBQ==",
    };
    const onePadding = Buffer.alloc(50).toString("base64");
    const twoPadding = Buffer.alloc(49).toString("base64");

    expect(onePadding.endsWith("A=")).toBe(true);
    expect(twoPadding.endsWith("A==")).toBe(true);
    expect(() =>
      SealedCredentialSchema.parse({
        ...base,
        ciphertext: `${onePadding.slice(0, -2)}B=`,
      }),
    ).toThrow("canonical Base64");
    expect(() =>
      SealedCredentialSchema.parse({
        ...base,
        ciphertext: `${twoPadding.slice(0, -3)}B==`,
      }),
    ).toThrow("canonical Base64");
  });
});
