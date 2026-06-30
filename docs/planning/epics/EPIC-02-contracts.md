---
id: EPIC-02
title: Benchmark and harness contracts
status: not_started
depends_on:
  - EPIC-01
owner:
branch:
pull_request:
last_updated:
---

# EPIC-02 — Benchmark and harness contracts

## Outcome and starting state

Define the provider-neutral language used by benchmarks, harnesses, runners, and the control plane. EPIC-01 provides the package and quality baseline.

## In scope

- Benchmark, ResponseBenchmark, and AgenticBenchmark abstract classes.
- HarnessAdapter, ProcessHarnessAdapter, and OpenAICompatibleModelProvider abstract classes.
- Manifests, capabilities, model routes, toolsets, limits, observations, tasks, cases, events, checkpoints, artifacts, errors, and typed metrics.
- Zod schemas for versioned serialized contracts.

## Explicitly out of scope

- Process spawning, HTTP calls, workspaces, persistence, routes, concrete providers, and dashboard code.

## Public interfaces affected

- The complete v1 TypeScript extension contract and protocol schema exports.

## TDD tracer and incremental behaviors

- [ ] RED: a response benchmark manifest cannot be validated through the public schema.
- [ ] GREEN: the smallest response manifest and metric validate.
- [ ] Add an agentic task, capability compatibility, event, checkpoint, and failure behavior one at a time.
- [ ] Prove serialized values round-trip without provider-specific fields.

## Implementation checklist

- [ ] Define stable IDs and semantic protocol versions.
- [ ] Define metric unit, direction, missing-data, and primary-metric behavior.
- [ ] Define discriminated event and failure unions.
- [ ] Define response and workspace lifecycle contracts.
- [ ] Export only deliberate public entrypoints.
- [ ] Add contract examples to package documentation.

## Acceptance criteria

- [ ] Contracts describe response and agentic benchmarks honestly.
- [ ] Unsupported capability combinations return typed validation failures.
- [ ] Wire schemas reject malformed or unknown-major-version payloads.
- [ ] Core coverage is 100% across all four metrics.

## Required verification commands

- pnpm --filter @llm-bench/contracts test:coverage
- pnpm typecheck
- pnpm lint
- pnpm boundaries
- pnpm build

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-03 implements these contracts locally. Do not add convenience fields solely for an imagined provider.
