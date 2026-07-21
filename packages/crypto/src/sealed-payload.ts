export const SEALED_PAYLOAD_VERSION = 1 as const;

export interface SealedPayload {
  v: typeof SEALED_PAYLOAD_VERSION;
  runnerId: string;
  secret: string;
}
