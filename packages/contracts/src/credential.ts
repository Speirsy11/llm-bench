import { z } from "zod";

/** Canonical libsodium sealed-box algorithm used across browser and runner. */
export const SEALED_CREDENTIAL_ALGORITHM =
  "x25519-xsalsa20poly1305-seal" as const;

const canonicalBase64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function isCanonicalBase64(value: string): boolean {
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}

export const CredentialMaskSchema = z
  .string()
  .regex(/^••••[A-Za-z0-9_-]{4}$/u, "Credential mask is invalid.");

/** Padded base64 encoding of exactly 32 raw X25519 key bytes. */
export const RawX25519KeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/u,
    "Expected canonical raw 32-byte X25519 key material.",
  );

/** Public-key alias used by the pairing protocol. */
export const RunnerPublicKeySchema = RawX25519KeySchema;

export const SealedCredentialSchema = z.strictObject({
  algorithm: z.literal(SEALED_CREDENTIAL_ALGORITHM),
  runnerId: z.uuid(),
  keyFingerprint: z
    .string()
    .regex(
      /^[A-Za-z0-9+/]{21}[AQgw]==$/u,
      "Expected a canonical 16-byte key fingerprint.",
    ),
  ciphertext: z
    .string()
    .regex(canonicalBase64)
    .refine(isCanonicalBase64, "Expected canonical Base64 ciphertext.")
    .min(68, "Expected a sealed box containing a non-empty credential.")
    .max(8_192, "Sealed credential is too large."),
});

export type SealedCredential = z.infer<typeof SealedCredentialSchema>;
