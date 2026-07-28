import type { SealedCredential } from "@llm-bench/contracts";
import {
  RunnerPublicKeySchema,
  SEALED_CREDENTIAL_ALGORITHM,
  SealedCredentialSchema,
} from "@llm-bench/contracts";

import type { SealedPayload } from "./sealed-payload";
import { fingerprintPublicKey } from "./keys";
import { SEALED_PAYLOAD_VERSION } from "./sealed-payload";
import { getSodium } from "./sodium";

export interface SealCredentialInput {
  /** Runner permitted to open the credential. */
  runnerId: string;
  /** Base64 raw X25519 public key of that runner. */
  recipientPublicKey: string;
  /** Plaintext secret, e.g. an OpenRouter API key. */
  secret: string;
}

/** Seal a secret in the browser for exactly one runner. */
export async function sealCredential(
  input: SealCredentialInput,
): Promise<SealedCredential> {
  const runnerId = SealedCredentialSchema.shape.runnerId.parse(input.runnerId);
  const publicKey = RunnerPublicKeySchema.parse(input.recipientPublicKey);
  if (input.secret.length === 0) {
    throw new Error("Cannot seal an empty credential.");
  }
  const sodium = await getSodium();
  const payload: SealedPayload = {
    v: SEALED_PAYLOAD_VERSION,
    runnerId,
    secret: input.secret,
  };
  const recipient = sodium.from_base64(
    publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const box = sodium.crypto_box_seal(
    sodium.from_string(JSON.stringify(payload)),
    recipient,
  );
  return SealedCredentialSchema.parse({
    algorithm: SEALED_CREDENTIAL_ALGORITHM,
    runnerId,
    keyFingerprint: await fingerprintPublicKey(publicKey),
    ciphertext: sodium.to_base64(box, sodium.base64_variants.ORIGINAL),
  });
}
