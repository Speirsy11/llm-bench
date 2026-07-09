# @llm-bench/pi-harness

The Pi CLI adapter for LLMBench. It drives `pi --headless --model <route>` over
stdio using JSON-RPC 2.0 messages.

Pi currently supports response generation only. Agentic workspace mode,
checkpoints, runner-managed tools, and MCP profiles are rejected before the
process starts. The adapter preserves parsed JSON-RPC events, normalizes text
output from response results, and records token observations when Pi reports a
`usage` object.

`probe()` checks only binary availability and CLI version. It does not read
provider authentication files or export credential state.

Supported CLI contract: Pi versions that provide `--headless`, `--model`,
`--version`, and the JSON-RPC `initialize` plus `conversation/send` stdio flow.
No stricter semver range is asserted until Pi publishes a stable compatibility
promise, so live environments should use `probe()` plus the opt-in smoke tests.

Required tests use local fixture executables and no credentials. Set
`LLMBENCH_LIVE_PI=1` and optionally `PI_BINARY=/path/to/pi` to run the paid live
smoke tests against the locally authenticated Pi CLI.
