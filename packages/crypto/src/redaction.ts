/**
 * Secret handling helpers. A resolved credential is wrapped so that accidental
 * logging, JSON serialisation, or string interpolation reveals a redaction
 * marker instead of the plaintext value.
 */

export const REDACTION_MARKER = "[redacted]" as const;

/**
 * Wraps a plaintext secret. `reveal()` is the single, explicit escape hatch used
 * only at the provider boundary; every other access path is redacted.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Returns the plaintext. Call only when handing the secret to a provider. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTION_MARKER;
  }

  toJSON(): string {
    return REDACTION_MARKER;
  }

  /** Ensures `util.inspect` / console logging never prints the plaintext. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTION_MARKER;
  }
}

/**
 * Replaces every occurrence of each secret substring with the redaction marker.
 * Empty secrets are ignored so a stray empty string cannot blank the input.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    output = output.split(secret).join(REDACTION_MARKER);
  }
  return output;
}
