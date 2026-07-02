---
id: EPIC-10
title: Claude Code and Pi harnesses
status: in_review
depends_on:
  - EPIC-09
owner: rocky
branch: codex/epic-10-claude-pi
pull_request:
last_updated: 2026-07-02
---

# EPIC-10 — Claude Code and Pi harnesses

## Outcome and starting state

Extend the proven process harness contract to Claude Code and Pi while preserving each harness's honest capabilities and metadata.

## In scope

- Claude streaming JSON, model, tool policy, workspace, budget, cancellation, authentication probe, and session resume.
- Pi headless JSON-RPC lifecycle, model/provider selection, tool capabilities, cancellation, and session behavior.
- Shared contract fixtures and opt-in live smoke tests.

## Explicitly out of scope

- Rewriting shared process lifecycle, MCP configuration, custom plugin installation, or dashboard analysis.

## Public interfaces affected

- ClaudeHarness and PiHarness manifests, typed configuration, events, capability reports, and checkpoints.

## TDD tracer and incremental behaviors

- [x] Run the shared harness contract suite against a fixture Claude executable, implementing one failing behavior at a time.
- [x] Repeat against a fixture Pi JSON-RPC process.
- [ ] Add only harness-specific tests for genuinely distinct public behavior.
- [ ] Prove unsupported options fail before a process starts.

## Implementation checklist

- [ ] Keep native authentication local and report only configured/unconfigured status.
- [ ] Map tool and permission settings explicitly.
- [ ] Distinguish process startup, harness, and model timing where data permits.
- [ ] Preserve raw usage or missing-data reasons.
- [ ] Document supported CLI version ranges.

## Acceptance criteria

- [ ] Claude and Pi pass the common response and agentic contract suites.
- [ ] No duplicated process-management implementation is introduced.
- [ ] Cancellation, limits, malformed output, and resume are covered.
- [ ] Optional live smoke commands are documented and excluded from normal CI.

## Required verification commands

- pnpm --filter @llm-bench/claude-harness test:coverage
- pnpm --filter @llm-bench/pi-harness test:coverage
- pnpm test:runner-contract
- pnpm typecheck
- pnpm lint

## Evidence log

| Date       | Agent           | Commit | Commands and outcome | Notes           |
| ---------- | --------------- | ------ | -------------------- | --------------- |
| 2026-07-02 | rocky | — | `pnpm test` — 21 packages pass; `pnpm typecheck` — pass; `pnpm lint` — pass; `pnpm boundaries` — pass; `pnpm --filter @llm-bench/claude-harness test:coverage` — 100%; `pnpm --filter @llm-bench/pi-harness test:coverage` — 100% | Web build failure pre-existing on main |

## Decisions or blockers

None.

## Handoff notes

EPIC-11 consumes advertised tool and MCP capabilities. Record adapter limitations rather than smoothing them over.
