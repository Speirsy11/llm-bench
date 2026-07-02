# @llm-bench/codex-harness

The Codex CLI adapter for LLMBench. It drives `codex exec --json` through the
common process-harness contract in two modes:

- response requests use the read-only sandbox;
- agentic requests use `workspace-write` rooted at the task workspace.

Runs use an explicit model, ignore user configuration and execution-policy
rules, preserve Codex's structured JSONL events, normalize token usage, and
retain only the opaque thread ID needed for an explicit resume. Ephemeral runs
never return a resumable checkpoint. `probe()` checks only binary availability
and `codex-cli` version; it does not inspect authentication files.

Token observations come from Codex's `turn.completed` usage object. Runner
duration measures the whole CLI process, including startup, local tool work,
and event serialization; it is not model-only generation latency.

Required tests use local fixture executables and no credentials. Set
`LLMBENCH_LIVE_CODEX=1 LLMBENCH_LIVE_CODEX_MODEL=<model>` to opt into the paid
smoke test against the locally authenticated Codex CLI.
