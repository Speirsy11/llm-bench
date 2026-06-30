# Agent workflow

This repository is deliberately split so one agent session can deliver one reviewable epic without reconstructing the entire project.

## 1. Select and claim

1. Read `PRODUCT_PLAN.md`, `DELIVERY_PLAN.md`, this file, and the selected epic brief.
2. Confirm every dependency is marked `complete` on `main`.
3. Create `codex/epic-XX-short-name` from current `main`.
4. Set the epic `status` to `in_progress` and fill `owner`, `branch`, and `last_updated`.
5. Do not claim a second epic in the same PR.

## 2. Work test-first

For each behavior:

1. Add one test through a public interface and observe the expected failure.
2. Add only enough implementation to make that behavior pass.
3. Refactor while green.
4. Check the corresponding task only after verification.

Prefer real internal paths over mocks. Replace only external boundaries: network providers, executable CLIs, wall-clock time, randomness, object storage, and sometimes the database when a real integration database is impractical. Expected values must be independent literals or specification examples, not values recomputed with production logic.

## 3. Respect scope

The epic's **In scope** and **Out of scope** sections are hard boundaries. Do not add placeholders for later work. If the current behavior cannot be completed without crossing a boundary:

- Record the issue under **Decisions or blockers**.
- Explain the smallest options and recommendation.
- Continue any unblocked work.
- Do not silently choose broader scope.

Existing user changes and unrelated files are preserved. Database migrations are forward-only. Never weaken security or coverage gates merely to make a check pass.

## 4. Verify and document

Run every command listed by the epic and every applicable repository-wide check. Add an evidence row containing the date, commit, exact commands, and outcome. Document new public interfaces and operational requirements in the same PR.

Before opening the PR:

- Fill all acceptance checkboxes.
- Add concise handoff notes for dependent epics.
- Set `status: in_review` and add the PR URL after creation.
- Update only the selected epic's row in `DELIVERY_PLAN.md`.

The status becomes `complete` in the final PR revision only when all checks and acceptance criteria pass. Because that revision reaches `main` with the merge, `main` remains the authoritative status view.

## 5. Pull request conventions

The PR description includes:

- Outcome delivered
- Observable behaviors added
- RED→GREEN slices completed
- Security, migration, or compatibility notes
- Verification evidence
- Explicit exclusions and follow-up epic links

Use meaningful behavior-level commits. A separate commit for every tiny RED and GREEN action is unnecessary, but the final diff must make the test-first contract obvious.

## Epic evidence template

| Date       | Agent           | Commit | Commands and outcome | Notes           |
| ---------- | --------------- | ------ | -------------------- | --------------- |
| YYYY-MM-DD | account/session | SHA    | `pnpm test` — pass   | Relevant caveat |
