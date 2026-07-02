import type { RunnerIdentity, SealedCredential } from "./types";
import { fingerprintPublicKey } from "./keys";
import { Secret } from "./redaction";
import { getSodium } from "./sodium";
import { SEALED_BOX_ALGORITHM } from "./types";

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

const SEALED_VERSION = 1 as const;

interface SealedPayload {
  v: typeof SEALED_VERSION;
  runnerId: string;
  secret: string;
}

export interface SealCredentialInput {
  /** Runner permitted to open the credential. */
  runnerId: string;
  /** Base64 raw X25519 public key of that runner. */
  recipientPublicKey: string;
  /** Plaintext secret, e.g. an OpenRouter API key. */
  secret: string;
}

/**
 * Seals a secret so only the runner holding the matching private key can open
 * it. The runner id is bound inside the authenticated ciphertext, so relabelling
 * a sealed credential for a different runner is detected on open.
 */
export async function sealCredential(
  input: SealCredentialInput,
): Promise<SealedCredential> {
  const sodium = await getSodium();
  const payload: SealedPayload = {
    v: SEALED_VERSION,
    runnerId: input.runnerId,
    secret: input.secret,
  };
  const recipient = sodium.from_base64(
    input.recipientPublicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const box = sodium.crypto_box_seal(
    sodium.from_string(JSON.stringify(payload)),
    recipient,
  );
  return {
    algorithm: SEALED_BOX_ALGORITHM,
    runnerId: input.runnerId,
    keyFingerprint: await fingerprintPublicKey(input.recipientPublicKey),
    ciphertext: sodium.to_base64(box, sodium.base64_variants.ORIGINAL),
  };
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
  if ((sealed.algorithm as string) !== SEALED_BOX_ALGORITHM) {
    throw new SealedCredentialError(
      `Unsupported sealed credential algorithm.`,
      "unsupported-algorithm",
    );
  }
  if (sealed.runnerId !== identity.runnerId) {
    throw new SealedCredentialError(
      `Sealed credential is addressed to a different runner.`,
      "wrong-runner",
    );
  }
  if (
    sealed.keyFingerprint !== (await fingerprintPublicKey(identity.publicKey))
  ) {
    throw new SealedCredentialError(
      `Sealed credential was sealed to a different key.`,
      "wrong-key",
    );
  }

  const sodium = await getSodium();
  const publicKey = sodium.from_base64(
    identity.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const privateKey = sodium.from_base64(
    identity.privateKey,
    sodium.base64_variants.ORIGINAL,
  );
  const ciphertext = sodium.from_base64(
    sealed.ciphertext,
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
    payload.v !== SEALED_VERSION ||
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
