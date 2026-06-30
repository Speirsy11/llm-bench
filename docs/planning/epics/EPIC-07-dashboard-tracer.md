---
id: EPIC-07
title: Dashboard experiment tracer
status: not_started
depends_on:
  - EPIC-05
  - EPIC-06
owner:
branch:
pull_request:
last_updated:
---

# EPIC-07 — Dashboard experiment tracer

## Outcome and starting state

Deliver the first complete dashboard-first user journey: manage a runner and sealed credential, configure one target matrix, launch repository repair, follow progress, cancel or retry, and inspect a result.

## In scope

- Runner, credential, model route, harness, toolset, experiment, progress, and basic result screens.
- Matrix expansion, projected job count, explicit spend confirmation, and round-robin ordering preview.
- Refresh-safe polling, cancellation, linked retry, empty/error/loading states, and ownership-safe mutations.
- Playwright flow using a fixture runner and provider.

## Explicitly out of scope

- Final charts, public showcase, full repair corpus, MCP, plugins, and external harnesses.

## Public interfaces affected

- Dashboard routes, form schemas, experiment orchestration service, status view models, and retry behavior.

## TDD tracer and incremental behaviors

- [ ] RED: an authenticated user cannot launch the existing tracer from the dashboard.
- [ ] GREEN: create a one-cell experiment and render its completed primary metric.
- [ ] Add multiple targets, confirmation, refresh, cancellation, retry, offline runner, incompatible target, and authorization behaviors one at a time.

## Implementation checklist

- [ ] Keep UI mutations thin over domain services.
- [ ] Reject incompatible capability combinations before enqueue.
- [ ] Preserve experiment configuration as an immutable snapshot.
- [ ] Display unknown cost and usage honestly.
- [ ] Meet keyboard, focus, labeling, and responsive-baseline requirements.

## Acceptance criteria

- [ ] Normal benchmark operation requires no terminal commands after runner pairing.
- [ ] Refreshing does not lose experiment or progress state.
- [ ] Cancellation and retry are explicit and auditable.
- [ ] Another user cannot observe or mutate the experiment.
- [ ] The critical Playwright flow passes reliably.

## Required verification commands

- pnpm --filter @llm-bench/web test:coverage
- pnpm test:integration
- pnpm test:e2e
- pnpm typecheck
- pnpm lint
- pnpm build

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-13 replaces basic result presentation with the final analysis and public showcase.
