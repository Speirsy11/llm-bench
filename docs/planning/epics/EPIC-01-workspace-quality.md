---
id: EPIC-01
title: Workspace and quality foundation
status: not_started
depends_on: []
owner:
branch:
pull_request:
last_updated:
---

# EPIC-01 — Workspace and quality foundation

## Outcome and starting state

Turn the retained starter tooling into a clean LLMBench monorepo baseline. Bootstrap contains planning documents and unadapted reusable tooling, but no product packages.

## In scope

- Rename internal tooling and templates to the @llm-bench scope.
- Establish foundation, service, feature, composition, app, and tooling boundaries.
- Configure Node 22, pnpm, strict TypeScript, ESLint, Prettier, Vitest, V8 coverage, Codecov, Renovate, CodeQL, and CI.
- Add root build, format, lint, workspace lint, typecheck, boundaries, test, coverage, and clean commands.
- Enforce 100% core and 90% app coverage policies with documented exclusions.

## Explicitly out of scope

- Product contracts, applications, database schemas, benchmark implementations, or placeholder UI.

## Public interfaces affected

- Repository commands, workspace naming rules, package templates, boundary tags, and CI checks.

## TDD tracer and incremental behaviors

- [ ] RED: a generated fixture package fails the intended workspace validation before the package template is corrected.
- [ ] GREEN: generated packages use the LLMBench scope and pass workspace validation.
- [ ] Add quality commands one behavior at a time, observing each fail before configuration is added.

## Implementation checklist

- [ ] Rename reusable tooling and generator references.
- [ ] Reduce the dependency catalog to deliberate shared dependencies.
- [ ] Configure Turbo tasks and boundary rules.
- [ ] Configure coverage thresholds and report formats.
- [ ] Add Linux CI jobs, Codecov upload, CodeQL, and Renovate.
- [ ] Document local prerequisites and commands.

## Acceptance criteria

- [ ] A clean clone installs with the pinned Node and pnpm versions.
- [ ] All root quality commands pass.
- [ ] CI runs without product secrets.
- [ ] No @charlie names or starter-product references remain.

## Required verification commands

- pnpm install --frozen-lockfile
- pnpm format
- pnpm lint
- pnpm lint:ws
- pnpm typecheck
- pnpm boundaries
- pnpm test:coverage
- pnpm build

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-02 and EPIC-04 consume this workspace baseline. Record final package templates and coverage exclusions here.
