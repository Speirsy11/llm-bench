---
id: EPIC-09
title: Process harness base and Codex
status: not_started
depends_on:
  - EPIC-05
owner:
branch:
pull_request:
last_updated:
---

# EPIC-09 — Process harness base and Codex

## Outcome and starting state

Create a robust subprocess harness foundation and prove it with Codex in both controlled-response and agentic workspace modes.

## In scope

- Process lifecycle, clean environment construction, stdin/stdout JSONL, output limits, redaction, process-group cancellation, checkpoints, and native workspace restrictions.
- Codex probing, explicit model and sandbox configuration, ephemeral sessions, structured events, and session resume.
- Fixture executable contract tests and opt-in live smoke tests.

## Explicitly out of scope

- Claude, Pi, plugins, MCP, dashboard redesign, and paid live tests in required CI.

## Public interfaces affected

- ProcessHarnessAdapter behavior, process-runner boundary, Codex manifest/configuration, and resume metadata.

## TDD tracer and incremental behaviors

- [ ] RED: a fixture Codex executable cannot complete the tracer through HarnessAdapter.
- [ ] GREEN: parse its public JSONL stream and produce a completed harness result.
- [ ] Add malformed event, stderr, non-zero exit, output overflow, cancellation, sandbox metadata, and resume one behavior at a time.
- [ ] Test public adapter behavior rather than private argument arrays.

## Implementation checklist

- [ ] Probe binary availability and version without reading authentication material.
- [ ] Run in the task workspace with explicit safe settings.
- [ ] Persist the minimum opaque session checkpoint required for resume.
- [ ] Normalize events without discarding raw provider metadata.
- [ ] Document the difference between model and CLI-harness timing.

## Acceptance criteria

- [ ] Codex handles response and repository-repair requests through the common contract.
- [ ] Process trees terminate on cancellation and timeout.
- [ ] Resume works when supported and fails honestly otherwise.
- [ ] Harness, model, version, sandbox, and environment metadata are recorded.
- [ ] Contract tests run without Codex credentials.

## Required verification commands

- pnpm --filter @llm-bench/process-harness test:coverage
- pnpm --filter @llm-bench/codex-harness test:coverage
- pnpm test:runner-contract
- pnpm typecheck
- pnpm lint

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-10 must extend this base rather than duplicating lifecycle behavior.
