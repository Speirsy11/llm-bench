# @llm-bench/mcp

Runner-local stdio MCP lifecycle and profile storage for LLMBench.

`McpProfileRegistry` stores the complete local profile in an owner-only file,
computes its immutable SHA-256 identity, detects persisted configuration
tampering, and returns sanitized metadata separately from executable arguments
and secret references. Profile imports cannot predeclare secret references:
the runner operator adds and revokes each environment grant locally, which
updates the profile identity atomically. Installation also attests the resolved
executable and direct interpreter script. Their paths and byte hashes stay
runner-local, are included in the immutable identity, and are reverified
immediately before every launch; missing, replaced, or symlink-retargeted
artifacts fail closed.

Accepted launch forms are deliberately narrow: either an attested native
executable with no arguments or flag-only arguments, or a direct
Node.js/Python/Bash/sh interpreter invocation whose first argument is the
attested script. The verified real paths of both executable and script are used
for launch. Command wrappers such as `env`, `npx`, and package managers;
unsupported interpreters such as Bun and Deno; interpreter options before a
script; and ambiguous positional inputs are rejected because the complete code
being executed cannot be attested.

`McpSession` launches one detached process group with a minimal environment,
resolves only named secrets, requires the supported negotiated MCP protocol
version, and redacts resolved values from capabilities, results, errors, CLI
output, and plugin bridge responses. Stdout is bounded per complete message and
partial buffer, allowing normal responses larger than 128 KiB without imposing
a lifetime cumulative limit. Stderr has a separate bounded session budget.
Cleanup escalates SIGTERM to SIGKILL.

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
