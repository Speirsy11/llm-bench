# LLMBench agent instructions

Before changing code:

1. Read `docs/planning/PRODUCT_PLAN.md`.
2. Read `docs/planning/DELIVERY_PLAN.md`.
3. Read `docs/planning/AGENT_WORKFLOW.md`.
4. Work on exactly one unblocked epic file from `docs/planning/epics/`.

Use test-driven vertical slices: one observable failing test, the minimum implementation to make it pass, then refactor while green. Test public behavior rather than private implementation.

Do not implement work assigned to later epics. If a required decision crosses the current epic boundary, record it under **Decisions or blockers** and stop that part of the work.

Before handing off, update the epic metadata, checklist, verification evidence, and the corresponding row in `docs/planning/DELIVERY_PLAN.md`.
