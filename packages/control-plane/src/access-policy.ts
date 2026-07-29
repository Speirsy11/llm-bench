export interface AuthContext {
  readonly userId: string;
  readonly githubLogin: string;
  readonly isAdmin: boolean;
}

export interface OwnedExperiment {
  readonly ownerId: string;
  readonly visibility: "private" | "public";
}

/**
 * Raw experiment rows are owner-only. Anonymous public reads must use the
 * sanitized public-result snapshot service.
 */
export function canReadExperiment(
  actor: AuthContext | null,
  experiment: OwnedExperiment,
): boolean {
  return actor?.userId === experiment.ownerId;
}

/** Experiment mutation is always owner-only, regardless of visibility. */
export function canMutateExperiment(
  actor: AuthContext,
  experiment: OwnedExperiment,
): boolean {
  return actor.userId === experiment.ownerId;
}

/** Only identities derived from the configured GitHub allowlist may curate. */
export function canCurateExperiment(actor: AuthContext): boolean {
  return actor.isAdmin;
}
