import { RunnerPublicKeySchema } from "@llm-bench/contracts";

import type { RunnerKeyPair } from "./types";
import { getSodium } from "./sodium";

/**
 * Generate a fresh X25519 key pair for a runner. The public key is advertised
 * during pairing; the private key stays in the runner's protected local store.
 */
export async function generateRunnerKeyPair(): Promise<RunnerKeyPair> {
  const sodium = await getSodium();
  const pair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(
      pair.publicKey,
      sodium.base64_variants.ORIGINAL,
    ),
    privateKey: sodium.to_base64(
      pair.privateKey,
      sodium.base64_variants.ORIGINAL,
    ),
  };
}

/**
 * Deterministic, non-secret fingerprint of a base64 public key. Used to detect
 * when a sealed credential is presented to a runner whose key does not match.
 */
export async function fingerprintPublicKey(publicKey: string): Promise<string> {
  const parsedPublicKey = RunnerPublicKeySchema.parse(publicKey);
  const sodium = await getSodium();
  const raw = sodium.from_base64(
    parsedPublicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const digest = sodium.crypto_generichash(16, raw);
  return sodium.to_base64(digest, sodium.base64_variants.ORIGINAL);
}
