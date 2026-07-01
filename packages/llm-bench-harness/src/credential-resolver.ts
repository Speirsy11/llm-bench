import type { RunnerIdentity, SealedCredential, Secret } from "@llm-bench/crypto";
import { openCredential } from "@llm-bench/crypto";

/** Raised when a required credential is not available to this runner. */
export class CredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialResolutionError";
  }
}

/**
 * Resolves sealed credentials into in-memory secrets for exactly one runner.
 * Only credentials sealed to this runner can be opened, and only requirements
 * that were registered can be requested.
 */
export class CredentialResolver {
  readonly #identity: RunnerIdentity;
  readonly #sealed: Map<string, SealedCredential>;

  constructor(
    identity: RunnerIdentity,
    sealed: Record<string, SealedCredential> = {},
  ) {
    this.#identity = identity;
    this.#sealed = new Map(Object.entries(sealed));
  }

  /** Names of the credentials this resolver can provide. */
  available(): string[] {
    return [...this.#sealed.keys()];
  }

  /** Opens the named credential in memory; throws if unknown or wrong-runner. */
  async resolve(requirement: string): Promise<Secret> {
    const sealed = this.#sealed.get(requirement);
    if (sealed === undefined) {
      throw new CredentialResolutionError(
        `No credential registered for requirement \`${requirement}\`.`,
      );
    }
    return openCredential(sealed, this.#identity);
  }
}
