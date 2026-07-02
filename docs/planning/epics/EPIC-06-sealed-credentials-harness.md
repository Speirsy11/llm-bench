---
id: EPIC-06
title: Sealed credentials and LLMBench harness
status: complete
depends_on:
  - EPIC-05
owner: Claude
branch: codex/epic-06-sealed-credentials-harness
pull_request: https://github.com/Speirsy11/llm-bench/pull/6
last_updated: 2026-07-02
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

- [x] RED: ciphertext created for runner A cannot yet drive an OpenRouter fixture call on runner A.
- [x] GREEN: runner A decrypts in memory and completes a fixture-backed harness turn.
- [x] Add wrong-runner denial, tamper detection, streaming, tool loop, limits, provider errors, cancellation, and secret redaction one behavior at a time.

## Implementation checklist

- [x] Use a reviewed cryptographic library; do not design custom primitives.
- [x] Keep plaintext out of database, job payloads, benchmark objects, diagnostics, and artifacts.
- [x] Pass credentials only to the provider boundary that declares the requirement.
- [x] Add path-contained read/list/search/patch and task-defined command tools.
- [x] Record missing provider metadata explicitly rather than as zero.

## Acceptance criteria

- [x] Only the selected runner decrypts a credential.
- [x] Modified ciphertext fails closed.
- [x] Secret canaries do not appear in any serialized result or log.
- [x] Agent loop stops on completion, cancellation, timeout, or configured limits.
- [x] OpenRouter transport behavior is covered without paid calls.

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
| 2026-07-02 | Codex | `ee9af85` | `pnpm format`, `pnpm lint`, `pnpm lint:ws`, `pnpm typecheck`, `pnpm boundaries`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm test`, `pnpm build` — pass | CI-equivalent environment with Postgres; package coverage gates are 100%. |

## Decisions or blockers

CodeQL's polynomial-regex finding was fixed with linear trailing-slash normalization and a slash-heavy regression test. The prior harness coverage failure was fixed by removing an unreachable array-lookup branch.

## Handoff notes

EPIC-07 can expose the completed credential and harness capabilities in the dashboard. EPIC-11 can extend toolsets without widening credential access.
