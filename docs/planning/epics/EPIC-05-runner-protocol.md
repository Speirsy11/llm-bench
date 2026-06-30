---
id: EPIC-05
title: Paired runner and durable job protocol
status: not_started
depends_on:
  - EPIC-03
  - EPIC-04
owner:
branch:
pull_request:
last_updated:
---

# EPIC-05 — Paired runner and durable job protocol

## Outcome and starting state

Connect the hosted control plane to a macOS/Linux runner that can pair, lease one job, execute the local tracer, buffer progress, and complete durably.

## In scope

- Runner CLI operations: login, start, stop, status, logout, doctor, and capability probe.
- Device-code pairing, revocable high-entropy runner tokens, and public-key registration.
- Versioned REST endpoints for heartbeat, lease, events, checkpoints, cancellation, completion, and artifact authorization.
- One-job concurrency, round-robin queue positions, event idempotency, network buffering, and capability-based resume.
- Short-lived direct upload authorization for private Vercel Blob.

## Explicitly out of scope

- Provider credentials, real LLM calls, dashboard experiment forms, MCP, and external harnesses.

## Public interfaces affected

- /api/v1/runner protocol, runner CLI commands, local spool format, job state machine, and artifact transport.

## TDD tracer and incremental behaviors

- [ ] RED: a paired fixture runner cannot lease and complete the existing tracer task.
- [ ] GREEN: pair, lease, execute, and complete one job through public HTTP endpoints.
- [ ] Add device-code expiry/replay, token revocation, lease race, duplicate event, cancellation, network loss, checkpoint resume, and artifact authorization one behavior at a time.

## Implementation checklist

- [ ] Persist only token hashes server-side.
- [ ] Store runner token, key material, event spool, and checkpoints with restrictive local permissions.
- [ ] Enforce runner ownership and protocol-major compatibility.
- [ ] Buffer events during network loss and replay idempotently.
- [ ] Mark unsupported or failed resume as interrupted; never auto-spend again.

## Acceptance criteria

- [ ] A fixture runner survives a network interruption without losing events.
- [ ] Two runners cannot lease the same job.
- [ ] Cancelled work terminates and reports partial artifacts.
- [ ] Expired, replayed, revoked, or cross-user credentials are rejected.
- [ ] Runner contract tests pass on macOS and Linux.

## Required verification commands

- pnpm --filter @speirsy11/llm-bench-runner test:coverage
- pnpm test:integration
- pnpm test:runner-contract
- pnpm typecheck
- pnpm lint

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-06 adds sealed credentials and the first real harness. EPIC-07 builds the human workflow on these endpoints.
