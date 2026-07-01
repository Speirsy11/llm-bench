/**
 * Public credential vocabulary. A runner owns an X25519 key pair; the browser
 * seals an OpenRouter key to that runner's public key so only the paired runner
 * can decrypt it locally.
 */

/** Algorithm tag stored alongside every sealed credential. */
export const SEALED_BOX_ALGORITHM = "x25519-xsalsa20poly1305-seal" as const;

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

/**
 * A credential sealed for exactly one runner. Only ciphertext and routing
 * metadata are stored — the plaintext secret is never persisted here.
 */
export interface SealedCredential {
  algorithm: typeof SEALED_BOX_ALGORITHM;
  /** Runner selected to decrypt this credential. */
  runnerId: string;
  /** Fingerprint of the recipient public key the ciphertext was sealed to. */
  keyFingerprint: string;
  /** Base64 libsodium sealed box. */
  ciphertext: string;
}
