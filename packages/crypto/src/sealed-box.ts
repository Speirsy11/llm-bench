import {
  RawX25519KeySchema,
  RunnerPublicKeySchema,
  SEALED_CREDENTIAL_ALGORITHM,
  SealedCredentialSchema,
} from "@llm-bench/contracts";

import type { SealedPayload } from "./sealed-payload";
import type { RunnerIdentity, SealedCredential } from "./types";
import { fingerprintPublicKey } from "./keys";
import { Secret } from "./redaction";
import { SEALED_PAYLOAD_VERSION } from "./sealed-payload";
import { getSodium } from "./sodium";

/** Raised when a sealed credential cannot be opened. Always fails closed. */
export class SealedCredentialError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "wrong-runner"
      | "wrong-key"
      | "unsupported-algorithm"
      | "tampered",
  ) {
    super(message);
    this.name = "SealedCredentialError";
  }
}

/**
 * Opens a sealed credential in memory on the target runner. Wrong-runner
 * routing, a mismatched key, an unknown algorithm, and any ciphertext tampering
 * all fail closed by throwing.
 */
export async function openCredential(
  sealed: SealedCredential,
  identity: RunnerIdentity,
): Promise<Secret> {
  if ((sealed.algorithm as string) !== SEALED_CREDENTIAL_ALGORITHM) {
    throw new SealedCredentialError(
      `Unsupported sealed credential algorithm.`,
      "unsupported-algorithm",
    );
  }
  const parsed = SealedCredentialSchema.safeParse(sealed);
  if (!parsed.success) {
    throw new SealedCredentialError(
      `Sealed credential metadata is malformed.`,
      "tampered",
    );
  }
  const envelope = parsed.data;
  if (envelope.runnerId !== identity.runnerId) {
    throw new SealedCredentialError(
      `Sealed credential is addressed to a different runner.`,
      "wrong-runner",
    );
  }
  if (
    envelope.keyFingerprint !==
    (await fingerprintPublicKey(
      RunnerPublicKeySchema.parse(identity.publicKey),
    ))
  ) {
    throw new SealedCredentialError(
      `Sealed credential was sealed to a different key.`,
      "wrong-key",
    );
  }

  const sodium = await getSodium();
  const publicKey = sodium.from_base64(
    RunnerPublicKeySchema.parse(identity.publicKey),
    sodium.base64_variants.ORIGINAL,
  );
  const privateKey = sodium.from_base64(
    RawX25519KeySchema.parse(identity.privateKey),
    sodium.base64_variants.ORIGINAL,
  );
  const ciphertext = sodium.from_base64(
    envelope.ciphertext,
    sodium.base64_variants.ORIGINAL,
  );

  let opened: Uint8Array;
  try {
    opened = sodium.crypto_box_seal_open(ciphertext, publicKey, privateKey);
  } catch {
    throw new SealedCredentialError(
      `Sealed credential failed authentication.`,
      "tampered",
    );
  }

  const payload = parsePayload(sodium.to_string(opened));
  if (payload.runnerId !== identity.runnerId) {
    throw new SealedCredentialError(
      `Sealed credential runner binding does not match.`,
      "tampered",
    );
  }
  return new Secret(payload.secret);
}

function parsePayload(raw: string): SealedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SealedCredentialError(
      `Sealed credential payload is not valid JSON.`,
      "tampered",
    );
  }
  const payload = parsed as Partial<SealedPayload>;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    payload.v !== SEALED_PAYLOAD_VERSION ||
    typeof payload.runnerId !== "string" ||
    typeof payload.secret !== "string"
  ) {
    throw new SealedCredentialError(
      `Sealed credential payload is malformed.`,
      "tampered",
    );
  }
  return payload as SealedPayload;
}
