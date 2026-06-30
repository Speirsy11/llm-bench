/**
 * Semantic protocol versioning for serialized wire contracts. Payloads carry a
 * `major.minor.patch` version; a peer accepts only its own major version.
 */

export const SUPPORTED_PROTOCOL_MAJOR = 1;
export const PROTOCOL_VERSION = "1.0.0";

export interface ProtocolVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseProtocolVersion(value: string): ProtocolVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) {
    throw new Error(`Invalid protocol version "${value}".`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** True when `value` is well-formed and shares the supported major version. */
export function isSupportedProtocolVersion(value: string): boolean {
  try {
    return parseProtocolVersion(value).major === SUPPORTED_PROTOCOL_MAJOR;
  } catch {
    return false;
  }
}
