---
id: EPIC-10
title: Claude Code and Pi harnesses
status: complete
depends_on:
  - EPIC-09
owner: Codex
branch: codex/epic-10-claude-pi
pull_request: https://github.com/Speirsy11/llm-bench/pull/11
last_updated: 2026-07-21
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
- [x] Add only harness-specific tests for genuinely distinct public behavior.
- [x] Prove unsupported options fail before a process starts.

## Implementation checklist

- [x] Keep native authentication local and report only configured/unconfigured status.
- [x] Map tool and permission settings explicitly.
- [x] Distinguish process startup, harness, and model timing where data permits.
- [x] Preserve raw usage or missing-data reasons.
- [x] Document supported CLI version ranges.

## Acceptance criteria

- [x] Claude passes the response and agentic fixture contracts; Pi passes the response JSON-RPC contract and rejects unsupported agentic requests before process start.
- [x] Shared process lifecycle behavior is centralized in `@llm-bench/process-harness`.
- [x] Cancellation, limits, malformed output, resume, and unsupported preflight paths are covered.
- [x] Optional live smoke commands are documented and excluded from normal CI.

## Required verification commands

- pnpm --filter @llm-bench/claude-harness test:coverage
- pnpm --filter @llm-bench/pi-harness test:coverage
- pnpm test:runner-contract
- pnpm typecheck
- pnpm lint

## Evidence log

| Date       | Agent           | Commit | Commands and outcome | Notes           |
| ---------- | --------------- | ------ | -------------------- | --------------- |
| 2026-07-09 | Codex | — | `pnpm --filter @llm-bench/claude-harness test:coverage` — pass, 100%; `pnpm --filter @llm-bench/pi-harness test:coverage` — pass, 100%; `pnpm --filter @llm-bench/process-harness test:coverage` — pass, 100%; `pnpm test:runner-contract` — pass; `pnpm lint:ws` — pass; `pnpm typecheck` — pass; `pnpm lint` — pass; `pnpm test` — pass; `pnpm format` — pass; `pnpm boundaries` — pass; `SKIP_ENV_VALIDATION=true pnpm build` — pass; `pnpm test:coverage` — blocked by missing `TEST_DATABASE_URL` for control-plane Postgres integration suites. | Live Claude/Pi smoke tests skipped unless explicitly enabled. Local commands emitted the existing Node engine warning because the project requests Node `^22.21.0` and the local shell is on Node `v26.3.0`. |
| 2026-07-02 | rocky | — | `pnpm test` — 21 packages pass; `pnpm typecheck` — pass; `pnpm lint` — pass; `pnpm boundaries` — pass; `pnpm --filter @llm-bench/claude-harness test:coverage` — 100%; `pnpm --filter @llm-bench/pi-harness test:coverage` — 100% | Web build failure pre-existing on main |

## Decisions or blockers

- PR [#8](https://github.com/Speirsy11/llm-bench/pull/8) implemented most of EPIC-10 but was closed unmerged, so its brief and package files were absent on `main`. This branch restores that work and finishes the missing preflight, documentation, contract, and verification pieces.
- Claude Code and Pi native authentication stays local to the user machine. Harness probes report configured or unconfigured state without reading or storing credentials.
- Runner-managed tools and MCP profiles are rejected before process start. EPIC-11 owns toolsets, MCP, and plugin support.
- Pi does not advertise workspace or session-resume support yet. Agentic and checkpoint requests fail in preflight until the adapter can honestly support those capabilities.
- Aggregate coverage currently requires a local Postgres `TEST_DATABASE_URL` for control-plane integration suites; EPIC-10 package coverage is green without that service.

## Handoff notes

EPIC-11 should consume the explicit preflight rejections for runner-managed tools and MCP profiles rather than assuming silent partial support. Do not enable Pi workspaces, checkpoints, or session resume until the Pi manifest and contract fixtures prove those behaviors.
