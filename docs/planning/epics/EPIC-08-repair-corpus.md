---
id: EPIC-08
title: TypeScript and Python repair corpus
status: not_started
depends_on:
  - EPIC-03
owner:
branch:
pull_request:
last_updated:
---

# EPIC-08 — TypeScript and Python repair corpus

## Outcome and starting state

Expand the single tracer into a balanced, deterministic repository-repair benchmark with three TypeScript and three Python tasks.

## In scope

- Six varied repair fixtures, known-good patches, visible tests, hidden graders, and explicit constraints.
- Node and Python capability requirements and offline setup.
- Content hashes, benchmark versioning, overall metrics, and per-language metrics.
- Regression and plausible-incomplete-patch tests.

## Explicitly out of scope

- Additional languages, external datasets, LLM judging, UI, and engine changes not required by an observed fixture behavior.

## Public interfaces affected

- Repository-repair benchmark catalog, task manifests, language capability declarations, and aggregate metrics.

## TDD tracer and incremental behaviors

- [ ] Add one fixture at a time: first prove it fails in the starter state, then prove the independent known patch passes.
- [ ] For each fixture, add at least one plausible incomplete repair that visible tests may miss and hidden grading rejects.
- [ ] Add language aggregation only after both language groups are independently green.

## Implementation checklist

- [ ] Cover distinct parsing, async/control-flow, state, API-boundary, and resource-cleanup failures.
- [ ] Keep fixtures small, licensed, deterministic, and network independent.
- [ ] Ensure hidden grader files are absent during execution.
- [ ] Record fixture and grader hashes in results.
- [ ] Document task intent without revealing hidden assertions.

## Acceptance criteria

- [ ] Three TypeScript and three Python tasks are runnable from clean fixtures.
- [ ] Every starter fixture fails for the intended behavior.
- [ ] Every known patch passes visible and hidden grading.
- [ ] Incomplete patches are detected.
- [ ] Overall and per-language metrics expose raw sample counts.

## Required verification commands

- pnpm --filter @llm-bench/repository-repair test:coverage
- pnpm test:fixtures
- pnpm typecheck
- pnpm lint
- pnpm boundaries

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

This epic may proceed in parallel after EPIC-03. Avoid touching control-plane or dashboard packages.
