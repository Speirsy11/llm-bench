---
id: EPIC-13
title: Charts and public showcase
status: not_started
depends_on:
  - EPIC-07
  - EPIC-08
  - EPIC-10
  - EPIC-11
  - EPIC-12
owner:
branch:
pull_request:
last_updated:
---

# EPIC-13 — Charts and public showcase

## Outcome and starting state

Turn the functional dashboard into a portfolio-quality public story and charts-first analysis workspace without hiding sample size, compatibility, or experimental conditions.

## In scope

- Editorial public landing page and curated result pages.
- Ranking and distribution charts, quality-versus-cost/time views, language breakdowns, chronological samples, and matrix fallback.
- Trajectory, diff, case, toolset, harness, and privacy-safe environment drill-downs.
- Administrator-only curation and sanitization workflow.
- Responsive, keyboard-accessible, light/dark presentation with complete loading, empty, error, and partial-data states.

## Explicitly out of scope

- Public sharing by ordinary users, new benchmark logic, new harnesses, and invented aggregate scores.

## Public interfaces affected

- Public result view model, chart-ready metric series, curation service, sanitization report, and dashboard navigation.

## TDD tracer and incremental behaviors

- [ ] RED: raw samples with different target conditions are presented as directly comparable.
- [ ] GREEN: compatibility grouping and warnings prevent the misleading comparison.
- [ ] Add distributions, sample counts, missing data, language breakdown, private artifact denial, curation, and accessibility behaviors one at a time.
- [ ] Test chart transformations with worked literal datasets.

## Implementation checklist

- [ ] Lead public pages with methodology and real curated evidence.
- [ ] Keep tables available for exact values and assistive technology.
- [ ] Sanitize usernames, paths, secrets, private prompts, and unapproved artifacts.
- [ ] Show explicit model, harness, toolset, benchmark, runner, and version variables.
- [ ] Avoid decorative rankings from one sample.

## Acceptance criteria

- [ ] Unsigned visitors understand the product and inspect curated comparisons.
- [ ] Private runs and blobs remain inaccessible.
- [ ] Incompatible results are never silently ranked together.
- [ ] Charts expose raw sample counts and missing data.
- [ ] Critical views pass automated accessibility and responsive checks.

## Required verification commands

- pnpm --filter @llm-bench/web test:coverage
- pnpm test:integration
- pnpm test:e2e
- pnpm test:a11y
- pnpm typecheck
- pnpm lint
- pnpm build

## Evidence log

| Date | Agent | Commit | Commands and outcome | Notes |
| ---- | ----- | ------ | -------------------- | ----- |

## Decisions or blockers

None.

## Handoff notes

EPIC-14 replaces fixture showcase data with verified real runs and completes deployment documentation.
