import { z } from "zod";

import { isSupportedProtocolVersion, PROTOCOL_VERSION } from "./version";

/**
 * Versioned wire envelope shared across the runner protocol. Every serialized
 * message carries its protocol version and a discriminating `kind`. A peer
 * accepts only payloads on its supported major version, and the strict object
 * rejects unknown (e.g. provider-specific) fields.
 */

export const WireEnvelopeSchema = z
  .strictObject({
    protocolVersion: z.string(),
    kind: z.string().min(1),
    payload: z.unknown(),
  })
  .refine((envelope) => isSupportedProtocolVersion(envelope.protocolVersion), {
    error: "Unsupported or malformed protocol version.",
    path: ["protocolVersion"],
  });
export type WireEnvelope = z.infer<typeof WireEnvelopeSchema>;

/** Wraps a payload in an envelope stamped with the current protocol version. */
export function encodeWire(kind: string, payload: unknown): WireEnvelope {
  return { protocolVersion: PROTOCOL_VERSION, kind, payload };
}

/** Parses and validates an envelope, throwing on an unsupported payload. */
export function decodeWire(raw: unknown): WireEnvelope {
  return WireEnvelopeSchema.parse(raw);
}
