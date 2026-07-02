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

## Fail-closed guarantees

`openCredential` throws — never returning plaintext — when the credential is
addressed to a different runner, was sealed to a different key, uses an unknown
algorithm, or has been tampered with (Poly1305 authentication or the inner
runner-id binding fails). These behaviours are covered to 100%.
