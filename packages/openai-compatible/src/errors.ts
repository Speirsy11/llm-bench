import type { ProviderErrorType } from "./types";

/**
 * Normalized provider error. Transport, HTTP, and decode failures are mapped to
 * a stable `type` plus a `retryable` hint so the harness can decide uniformly.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly type: ProviderErrorType,
    readonly retryable: boolean,
    readonly status: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/** Maps an HTTP status and optional provider error body to a ProviderError. */
export function errorFromResponse(
  status: number,
  body: string,
): ProviderError {
  const message = extractErrorMessage(body) ?? `Provider request failed (${status}).`;
  if (status === 401 || status === 403) {
    return new ProviderError(message, "authentication", false, status);
  }
  if (status === 429) {
    return new ProviderError(message, "rate_limit", true, status);
  }
  if (status >= 500) {
    return new ProviderError(message, "server_error", true, status);
  }
  return new ProviderError(message, "invalid_request", false, status);
}

function extractErrorMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = (parsed as { error: unknown }).error;
      if (typeof error === "string") return error;
      if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message: unknown }).message === "string"
      ) {
        return (error as { message: string }).message;
      }
    }
  } catch {
    // Non-JSON error bodies fall through to the default message.
  }
  return null;
}
