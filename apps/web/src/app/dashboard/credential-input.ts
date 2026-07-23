import { CredentialMaskSchema } from "@llm-bench/contracts";

const OPENROUTER_PREFIX = "sk-or-v1-";
const MINIMUM_OPAQUE_TAIL_LENGTH = 16;

export function maskOpenRouterSecret(secret: string): string {
  if (
    !secret.startsWith(OPENROUTER_PREFIX) ||
    secret.length < OPENROUTER_PREFIX.length + MINIMUM_OPAQUE_TAIL_LENGTH
  ) {
    throw new Error("Enter a valid OpenRouter API key.");
  }
  return `••••${secret.slice(-4)}`;
}

export function validateMaskedSecret(maskedSecret: string): string {
  return CredentialMaskSchema.parse(maskedSecret);
}
