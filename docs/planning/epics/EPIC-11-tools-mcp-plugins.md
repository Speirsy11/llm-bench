---
id: EPIC-11
title: Toolsets, MCP, and plugin SDK
status: not_started
depends_on:
  - EPIC-06
  - EPIC-09
  - EPIC-10
owner:
branch:
pull_request:
last_updated:
---

# EPIC-11 — Toolsets, MCP, and plugin SDK

## Outcome and starting state

Allow users to compare explicit toolsets, connect runner-installed MCP servers, and add locally installed harness executables through a stable SDK and protocol.

## In scope

- Versioned toolset manifests and per-harness compatibility validation.
- Runner-local MCP add, remove, list, probe, start, stop, secret-reference, and capability operations.
- Dashboard selection of advertised MCP profiles without executable installation or raw secrets.
- Versioned executable JSONL plugin protocol and @speirsy11/llm-bench-harness-sdk.
- Example external plugin and explicit per-plugin credential grants.

## Explicitly out of scope

- Remote plugin registry, dashboard code upload, automatic installation, arbitrary server-side commands, and implicit credential access.

## Public interfaces affected

- Toolset contract, MCP profile metadata, runner operational CLI, plugin manifest, JSONL protocol, and SDK exports.

## TDD tracer and incremental behaviors

- [ ] RED: a locally installed example plugin cannot advertise and execute the tracer task.
- [ ] GREEN: handshake, capability validation, execution, and completion work through the public protocol.
- [ ] Add protocol mismatch, malformed output, missing capability, credential denial, MCP startup failure, cancellation, and cleanup one behavior at a time.

## Implementation checklist

- [ ] Require explicit local operator action for installation.
- [ ] Launch plugins and MCP servers with clean, scoped environments.
- [ ] Resolve MCP secrets only on the runner.
- [ ] Translate common toolset intent without claiming false cross-harness equivalence.
- [ ] Publish SDK API documentation and an example package.

## Acceptance criteria

- [ ] Example plugin completes repository repair with an explicit toolset.
- [ ] Plugin receives no credentials without an explicit grant.
- [ ] MCP processes terminate after job completion or failure.
- [ ] Dashboard cannot install executable code.
- [ ] Unknown protocol major versions fail with an actionable update error.

## Required verification commands

- pnpm --filter @speirsy11/llm-bench-harness-sdk test:coverage
- pnpm --filter @llm-bench/mcp test:coverage
- pnpm test:runner-contract
- pnpm test:integration
- pnpm typecheck
- pnpm lint

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-13 displays toolset and MCP variables. Document security warnings and capability mismatches for that UI.
