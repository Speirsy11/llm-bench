/**
 * Public credential vocabulary. A runner owns an X25519 key pair; the browser
 * seals an OpenRouter key to that runner's public key so only the paired runner
 * can decrypt it locally.
 */

import { SEALED_CREDENTIAL_ALGORITHM } from "@llm-bench/contracts";

export { SEALED_CREDENTIAL_ALGORITHM } from "@llm-bench/contracts";
export type { SealedCredential } from "@llm-bench/contracts";

/** @deprecated Use the canonical shared contract name. */
export const SEALED_BOX_ALGORITHM = SEALED_CREDENTIAL_ALGORITHM;

/** Raw X25519 key material, base64-encoded for transport and storage. */
export interface RunnerKeyPair {
  /** Base64 raw X25519 public key advertised during pairing. */
  publicKey: string;
  /** Base64 raw X25519 secret key; never leaves the runner. */
  privateKey: string;
}

/** A runner key pair together with the runner id it is bound to. */
export interface RunnerIdentity extends RunnerKeyPair {
  runnerId: string;
}
