---
id: EPIC-04
title: Web, authentication, and persistence foundation
status: not_started
depends_on:
  - EPIC-01
  - EPIC-02
owner:
branch:
pull_request:
last_updated:
---

# EPIC-04 — Web, authentication, and persistence foundation

## Outcome and starting state

Create the hosted control-plane shell with GitHub identity, Neon persistence, ownership rules, and public/private routing. No runner execution is required yet.

## In scope

- Next.js app shell and shared UI foundation.
- Auth.js GitHub OAuth and framework-independent auth context.
- Neon Postgres, Drizzle client, checked-in forward migrations, and test database setup.
- Initial users, runners, experiments, targets, jobs, attempts, results, metrics, artifacts, and visibility schema.
- Domain services enforcing ownership and visibility.
- Public landing placeholder and authenticated dashboard shell.

## Explicitly out of scope

- Pairing endpoints, credentials, benchmark execution, final dashboard screens, and charts.

## Public interfaces affected

- Auth context, persistence repositories, domain service methods, database schema, and route access policy.

## TDD tracer and incremental behaviors

- [ ] RED: an anonymous visitor cannot distinguish public and private experiment access.
- [ ] GREEN: public data is readable and private data requires its owner.
- [ ] Add cross-user denial, administrator curation permission, migration, and session behavior one at a time.
- [ ] Use real Postgres integration tests for ownership queries.

## Implementation checklist

- [ ] Replace all Clerk assumptions with Auth.js GitHub identity.
- [ ] Add validated environment blocks and safe example variables.
- [ ] Add deterministic migration and test reset commands.
- [ ] Keep Next.js handlers thin over domain services.
- [ ] Document local GitHub OAuth and Neon setup.

## Acceptance criteria

- [ ] Public and authenticated shells render correctly.
- [ ] Users cannot read or mutate another user's private records.
- [ ] Only an allowlisted administrator can mark curated public data.
- [ ] Migrations apply to an empty database and are reproducible in CI.

## Required verification commands

- pnpm --filter @llm-bench/web test:coverage
- pnpm test:integration
- pnpm typecheck
- pnpm lint
- pnpm build

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-05 adds runner-facing REST behavior on these services. Record migration identifiers and test database conventions.
