/** Browser-safe credential sealing surface. This graph contains no opening or filesystem APIs. */
export { fingerprintPublicKey } from "./keys";
export { sealCredential, type SealCredentialInput } from "./seal";
