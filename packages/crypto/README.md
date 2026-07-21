# @llm-bench/crypto

Sealed-credential primitives for LLMBench. A dashboard-entered OpenRouter key is
sealed in the browser to a single runner's public key and can only be opened, in
memory, by the paired runner that holds the matching private key. The server, job
payloads, benchmarks, diagnostics, and artifacts never see the plaintext.

This package uses [libsodium](https://doc.libsodium.org/) sealed boxes
(`crypto_box_seal`, X25519 + XSalsa20-Poly1305). It designs **no** cryptographic
primitives of its own.

## What it provides

- **`generateRunnerKeyPair`** — a fresh X25519 key pair (raw keys, base64). The
  public key is advertised during pairing; the private key stays local.
- **`sealCredential` / `openCredential`** — anonymous sealed-box encryption to a
  runner's public key, and in-memory decryption on that runner. The runner id is
  bound inside the authenticated ciphertext.
- **`Secret`** — a wrapper whose `toString`, `toJSON`, and `util.inspect` output
  is `[redacted]`; the plaintext is available only through the explicit
  `reveal()` escape hatch used at the provider boundary.
- **`redactSecrets`** — removes known secret substrings from arbitrary text.
- **`RunnerCredentialStore`** — atomic `0600`/`0700` on-disk storage for the
  runner key pair and the sealed (ciphertext-only) credential profiles.

## Browser and plaintext boundary

Browser code imports the seal-only entry point:

```ts
import { sealCredential } from "@llm-bench/crypto/browser";

const sealed = await sealCredential({
  runnerId,
  recipientPublicKey: runnerPublicKey,
  secret: openRouterApiKey,
});
```

`@llm-bench/crypto/browser` exports sealing and public-key fingerprinting only;
it does not expose credential opening, private-key, or filesystem APIs. The
dashboard submits the sealed algorithm, runner binding, key fingerprint, and
ciphertext—not the OpenRouter plaintext—to the server.

On the selected runner, `openCredential` returns a `Secret` in memory. Its
redacted string and JSON behavior is the default; `reveal()` is used only at the
OpenRouter authorization-header boundary. Native-auth Codex and Claude targets
do not open or receive the OpenRouter ciphertext.

## Key format and re-pairing

Runner public and private keys are canonical Base64 encodings of raw 32-byte
X25519 material. Protocol `2.0` rejects the longer SPKI/PKCS8 DER encodings used
by earlier local runner state. No in-place migration is implemented: the runner
fails closed and requires re-pairing. Preserve or remove the legacy
`credentials.json`, pair again to generate raw keys, and recreate any credential
profile sealed to the old public key. The
[runner operations guide](../runner/README.md) gives the recovery commands.

## Fail-closed guarantees

`openCredential` throws — never returning plaintext — when the credential is
addressed to a different runner, was sealed to a different key, uses an unknown
algorithm, or has been tampered with (Poly1305 authentication or the inner
runner-id binding fails). These behaviours are covered to 100%.
