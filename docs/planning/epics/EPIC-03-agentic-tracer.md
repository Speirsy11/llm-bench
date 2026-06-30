---
id: EPIC-03
title: Local agentic tracer
status: not_started
depends_on:
  - EPIC-02
owner:
branch:
pull_request:
last_updated:
---

# EPIC-03 — Local agentic tracer

## Outcome and starting state

Prove one repository-repair task end to end without a server: prepare an ephemeral repository, run a deterministic executable harness, inject hidden grading, produce typed results and artifacts, and clean up.

## In scope

- Local execution engine and public execution entrypoint.
- Ephemeral workspace lifecycle with path containment.
- Append-only JSONL event spool and artifact storage abstraction.
- Cancellation, timeout, grading boundary, diff capture, and cleanup.
- One TypeScript repair fixture, known patch, hidden tests, and deterministic fixture harness.

## Explicitly out of scope

- Network control plane, database, real model calls, native agent CLIs, Python tasks, and UI.

## Public interfaces affected

- Local agentic execution service, workspace abstraction, grader result, and artifact adapter.

## TDD tracer and incremental behaviors

- [ ] RED: the fixture harness repairs the task but no graded result is produced.
- [ ] GREEN: execute through AgenticBenchmark and return an independent hidden-test ratio.
- [ ] Add failed repair, cancellation, timeout, path escape, malformed event, artifact, and cleanup behaviors one at a time.
- [ ] Refactor only after each behavior is green.

## Implementation checklist

- [ ] Create fixture setup and hidden-grader phases.
- [ ] Ensure hidden tests are absent during harness execution.
- [ ] Capture trajectory, final diff, timing, constraints, and errors.
- [ ] Retain interrupted workspaces only when required for resume.
- [ ] Delete terminal workspaces and temporary secrets.

## Acceptance criteria

- [ ] The broken fixture fails before repair and the known patch passes.
- [ ] An incomplete patch is detected by hidden tests.
- [ ] Workspace traversal and symlink escape are rejected.
- [ ] Cancellation and timeouts terminate work and preserve honest partial results.
- [ ] Terminal cleanup is verified through the public execution result.

## Required verification commands

- pnpm --filter @llm-bench/runner-engine test:coverage
- pnpm --filter @llm-bench/repository-repair test:coverage
- pnpm typecheck
- pnpm lint
- pnpm boundaries

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-05 will invoke this engine through leased jobs. EPIC-08 expands the corpus without changing the engine contract.
