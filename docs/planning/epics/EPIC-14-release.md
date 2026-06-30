---
id: EPIC-14
title: Hardening, deployment, documentation, and release
status: not_started
depends_on:
  - EPIC-01
  - EPIC-02
  - EPIC-03
  - EPIC-04
  - EPIC-05
  - EPIC-06
  - EPIC-07
  - EPIC-08
  - EPIC-09
  - EPIC-10
  - EPIC-11
  - EPIC-12
  - EPIC-13
owner:
branch:
pull_request:
last_updated:
---

# EPIC-14 — Hardening, deployment, documentation, and release

## Outcome and starting state

Audit, document, deploy, and publish the complete v1 so a new user can move from GitHub sign-in to a paired runner and an inspectable benchmark result.

## In scope

- Threat model, SECURITY.md, credential audit, dependency and supply-chain audit, accessibility review, migration rehearsal, performance checks, recovery drills, and privacy review.
- README, architecture, ADRs, methodology, benchmark-authoring guide, plugin tutorial, deployment guide, runner troubleshooting, and reproducibility documentation.
- Vercel, Neon, and private Vercel Blob production deployment.
- Real curated LLMBench/Pi same-model results plus clearly labelled Codex and Claude results.
- OIDC trusted staged npm publishing with provenance for the runner and SDK.
- Final branch protection, changelog, versioning, and release automation.

## Explicitly out of scope

- Any deferred product capability from PRODUCT_PLAN.md or unplanned architectural rewrite.

## Public interfaces affected

- Production deployment, package manifests, release workflows, documentation, support policy, and security disclosure process.

## TDD tracer and incremental behaviors

- [ ] Convert each discovered audit risk into a failing automated check or documented manual release check before remediation.
- [ ] Rehearse an empty-database deployment and runner onboarding before production promotion.
- [ ] Stage packages, inspect their contents and provenance, then approve with 2FA.

## Implementation checklist

- [ ] Verify no plaintext credentials or private samples exist in repository history or production records.
- [ ] Test backup, migration, runner revocation, interrupted job, and artifact deletion paths.
- [ ] Generate public samples with explicit immutable model and harness versions.
- [ ] Configure npm trusted publishers only after the @speirsy11 account and packages exist.
- [ ] Require protected-main checks and reviewed releases.

## Acceptance criteria

- [ ] Fresh-clone and hosted onboarding documentation is independently followed successfully.
- [ ] Production health and critical user journey pass.
- [ ] Security, privacy, accessibility, and recovery reviews have recorded evidence.
- [ ] npm packages are provenance-backed, staged, inspected, and manually approved.
- [ ] Public samples are real, sanitized, reproducible, and honestly labelled.

## Required verification commands

- pnpm format
- pnpm lint
- pnpm lint:ws
- pnpm typecheck
- pnpm boundaries
- pnpm test
- pnpm test:coverage
- pnpm test:integration
- pnpm test:e2e
- pnpm build
- npm pack --dry-run for each public package

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

- npm account creation and 2FA are owner-operated release prerequisites.

## Handoff notes

Record production URLs, release versions, remaining deferred scope, and post-release monitoring ownership.
