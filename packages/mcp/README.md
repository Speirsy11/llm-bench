# @llm-bench/mcp

Runner-local stdio MCP lifecycle and profile storage for LLMBench.

`McpProfileRegistry` stores the complete local profile in an owner-only file,
computes its immutable SHA-256 identity, detects persisted configuration
tampering, and returns sanitized metadata separately from executable arguments
and secret references. `McpSession` launches one detached process group with a
minimal environment, resolves only named secrets, performs a bounded MCP
initialize request, buffers split JSON-RPC lines correctly, and escalates
SIGTERM to SIGKILL during cleanup.

Profiles are intentionally local and stdio-only. The hosted control plane sees
only `id`, `version`, `contentHash`, and advertised tool names. It cannot send
commands, install servers, or receive executable paths, arguments, working
directories, secret-reference names, or secret values.

The runner operations guide contains the profile format and commands:
[`packages/runner/README.md`](../runner/README.md#runner-installed-mcp-profiles).

```bash
pnpm --filter @llm-bench/mcp test:coverage
pnpm --filter @llm-bench/mcp typecheck
pnpm --filter @llm-bench/mcp lint
```
