---
id: EPIC-06
title: Sealed credentials and LLMBench harness
status: not_started
depends_on:
  - EPIC-05
owner:
branch:
pull_request:
last_updated:
---

# EPIC-06 — Sealed credentials and LLMBench harness

## Outcome and starting state

Allow a dashboard-entered OpenRouter key to be sealed for one runner and used locally by LLMBench's bounded agent harness without exposing the secret to the server, benchmark, logs, or artifacts.

## In scope

- Runner encryption key generation and protected local storage.
- Browser-side sealed-box encryption and runner-specific credential profiles.
- OpenAI-compatible request, streaming, tool-call, usage, and error normalization.
- OpenRouterProvider and the configurable LLMBench agent loop.
- Bounded turns, cancellation, credential resolution, and safe repository tools.

## Explicitly out of scope

- MCP, custom plugins, external CLIs, final credential UI polish, and server-side decryption.

## Public interfaces affected

- Credential profile contract, OpenAI-compatible provider base, OpenRouter provider, LLMBench harness, and built-in tool events.

## TDD tracer and incremental behaviors

- [ ] RED: ciphertext created for runner A cannot yet drive an OpenRouter fixture call on runner A.
- [ ] GREEN: runner A decrypts in memory and completes a fixture-backed harness turn.
- [ ] Add wrong-runner denial, tamper detection, streaming, tool loop, limits, provider errors, cancellation, and secret redaction one behavior at a time.

## Implementation checklist

- [ ] Use a reviewed cryptographic library; do not design custom primitives.
- [ ] Keep plaintext out of database, job payloads, benchmark objects, diagnostics, and artifacts.
- [ ] Pass credentials only to the provider boundary that declares the requirement.
- [ ] Add path-contained read/list/search/patch and task-defined command tools.
- [ ] Record missing provider metadata explicitly rather than as zero.

## Acceptance criteria

- [ ] Only the selected runner decrypts a credential.
- [ ] Modified ciphertext fails closed.
- [ ] Secret canaries do not appear in any serialized result or log.
- [ ] Agent loop stops on completion, cancellation, timeout, or configured limits.
- [ ] OpenRouter transport behavior is covered without paid calls.

## Required verification commands

- pnpm --filter @llm-bench/crypto test:coverage
- pnpm --filter @llm-bench/openai-compatible test:coverage
- pnpm --filter @llm-bench/llm-bench-harness test:coverage
- pnpm test:integration
- pnpm typecheck
- pnpm lint

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-07 exposes these capabilities in the dashboard. EPIC-11 extends toolsets without widening credential access.
