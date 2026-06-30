# LLMBench agent instructions

Before changing code, read the local planning files when they are available:

1. `docs/planning/PRODUCT_PLAN.md`
2. `docs/planning/DELIVERY_PLAN.md`
3. `docs/planning/AGENT_WORKFLOW.md`
4. One unblocked epic file from `docs/planning/epics/`

The `docs/` directory is intentionally local and Git-ignored. If these files are absent, request the relevant epic brief from the repository owner before implementing an epic.

Use test-driven vertical slices: one observable failing test, the minimum implementation to make it pass, then refactor while green. Test public behavior rather than private implementation.

Do not implement work assigned to later epics. If a required decision crosses the current epic boundary, record it under **Decisions or blockers** and stop that part of the work.

Before handing off, update the epic metadata, checklist, verification evidence, and the corresponding row in `docs/planning/DELIVERY_PLAN.md`.
