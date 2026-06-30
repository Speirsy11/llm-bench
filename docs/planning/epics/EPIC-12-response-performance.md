---
id: EPIC-12
title: Response and performance benchmarks
status: not_started
depends_on:
  - EPIC-06
  - EPIC-10
owner:
branch:
pull_request:
last_updated:
---

# EPIC-12 — Response and performance benchmarks

## Outcome and starting state

Add deterministic non-workspace benchmarks and statistically honest performance measurements across every harness that advertises the required capabilities.

## In scope

- Structured-output and instruction-following response benchmark packages.
- Controlled performance benchmark with one warm-up and five measured samples by default.
- Three default response repetitions and one default agentic repetition.
- Duration, TTFT, usage, cost, throughput, percentiles, variance, missing-data reasons, and sample counts.
- Compatibility preflight and truthful target-kind labeling.

## Explicitly out of scope

- LLM judges, universal normalized scores, final chart design, and paid live calls in required CI.

## Public interfaces affected

- Response benchmark catalog, performance metric definitions, aggregation utilities, and experiment default policies.

## TDD tracer and incremental behaviors

- [ ] RED: a known structured-output response cannot be graded through ResponseBenchmark.
- [ ] GREEN: return an independent schema-compliance metric.
- [ ] Add instruction constraints one case at a time.
- [ ] Add warm-up exclusion, percentile, variance, missing TTFT, missing usage, and incompatible harness behaviors individually with fake time.

## Implementation checklist

- [ ] Keep expected values independent of production aggregation code.
- [ ] Never convert missing metrics to zero.
- [ ] Separate provider request time from process/harness time where observable.
- [ ] Preserve raw samples behind every aggregate.
- [ ] Reject unsupported combinations before spending.

## Acceptance criteria

- [ ] All capable built-in harnesses run applicable response benchmarks.
- [ ] Performance aggregates match worked literal examples.
- [ ] Warm-up samples do not enter measured distributions.
- [ ] Missing metadata remains explicit.
- [ ] No misleading cross-kind score is introduced.

## Required verification commands

- pnpm --filter @llm-bench/structured-output test:coverage
- pnpm --filter @llm-bench/instruction-following test:coverage
- pnpm --filter @llm-bench/performance test:coverage
- pnpm typecheck
- pnpm lint
- pnpm boundaries

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-13 consumes metric units, directions, samples, and compatibility labels. Treat them as stable public data.
