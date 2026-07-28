# LLMBench example harness plugin

A deliberately small, executable example of the
`@speirsy11/llm-bench-harness-sdk` JSONL protocol. It advertises a
repository-repair-compatible manifest and completes the
`typescript-clamp-bounds` tracer by applying the fixture's minimal repair.

This package is an example for local plugin authors, not a general-purpose
model harness. The runner operator must install and select a plugin explicitly;
the dashboard cannot upload or install this executable.

## Protocol behavior

The executable reads exactly the normal per-job lifecycle from standard input:

1. `handshake_request`
2. `run_request`

It writes a `handshake_reply`, a contiguous sequence of run events, exactly one
terminal result, and then exits. Its manifest advertises:

- harness id `example-harness-plugin`;
- capabilities `response_generation`, `workspaces`, and `files`;
- model route `example-clamp-repair`;
- version `1.0.0`.

The selected run must be repository-repair `1.0.0`, case
`typescript-clamp-bounds`, and its explicit toolset must contain
`apply_patch`. Unsupported cases or toolsets fail before the workspace is
changed. A successful result echoes the complete selected toolset in metadata
so an integration can verify which experimental variable was used.

## Credential policy

The example needs no credentials and intentionally denies every explicit
credential grant. Omitted `credentials` therefore uses the SDK's safe `{}`
default. The executable never reads provider keys or other ambient environment
variables, and credential values are never written to stdout, stderr, result
metadata, or the workspace.

Real plugins that require credentials should accept only named grants from the
run request. They must not fall back to `process.env`, home-directory config, or
provider CLI authentication.

## Build and verify

```bash
pnpm --filter @llm-bench/example-harness-plugin test:coverage
pnpm --filter @llm-bench/example-harness-plugin typecheck
pnpm --filter @llm-bench/example-harness-plugin lint
pnpm --filter @llm-bench/example-harness-plugin build
```

The build produces `dist/cli.js` with a Node shebang and bundles the SDK runtime
used by the executable. Tests also build the entrypoint into a temporary
directory, run it as a real child process, send a two-line transcript, and
execute the repaired clamp module.
