# @llm-bench/claude-harness

The Claude Code CLI adapter for LLMBench. It drives `claude --print` with
`--output-format stream-json` through the shared process-harness lifecycle.

Response requests run in the `read-only` sandbox. Agentic requests run in
`workspace-write` rooted at the task workspace. The adapter preserves native
Claude JSON events, normalizes token observations from assistant usage, and
retains only the opaque `session_id` needed for explicit resume. Ephemeral runs
never return a resumable checkpoint.

`probe()` checks only binary availability and CLI version. It does not read
Claude authentication files or export credential state. Runner-managed tools and
MCP profiles are rejected before the process starts; EPIC-11 owns those
integrations.

Supported CLI contract: Claude Code versions that provide `--print`,
`--output-format stream-json`, `--sandbox`, `--cd`, `--ephemeral`, and
`resume --session-id`. No stricter semver range is asserted until Claude Code
publishes a stable compatibility promise, so live environments should use
`probe()` plus the opt-in smoke tests.

Required tests use local fixture executables and no credentials. Set
`LLMBENCH_LIVE_CLAUDE=1` and optionally `CLAUDE_BINARY=/path/to/claude` to run
the paid live smoke tests against the locally authenticated Claude Code CLI.
