# @speirsy11/llm-bench-harness-sdk

The standalone TypeScript vocabulary for locally installed LLMBench executable
harness plugins. It defines the versioned JSONL messages exchanged with a
runner; it does not spawn processes, access the network, or import runner code.

## Protocol lifecycle

The runner writes a `handshake_request`. A plugin replies with a strict
`handshake_reply` containing its manifest, advertised capabilities, and model
routes. The runner then writes a `run_request`; the plugin writes zero or more
ordered `run_event` messages and exactly one `run_result` with `completed`,
`failed`, or `cancelled` status.

Run requests name the job and benchmark case, carry one prompt and workspace,
and select a concrete toolset: explicit tool names plus versioned,
content-hashed MCP profiles. Limits are `maxDurationMs`, `maxToolCalls`,
`maxTokens`, and `maxTurns`. Checkpoints state whether they are resumable. A
completed result carries output, nullable numeric metric observations, a
checkpoint, and metadata; failed and cancelled results only report their
honest terminal information.

For each selected MCP profile, `runtime.mcpConnections` supplies its immutable
identity and an absolute runner-owned Unix socket path. Plugins send newline-
delimited JSON-RPC requests to that socket. The descriptor contains no MCP
command, arguments, environment, or secret reference, and it is valid only for
the current job.

Every message is one UTF-8 JSON line of at most 1 MiB. Use the helpers rather
than parsing unbounded stdin yourself:

```ts
import type { HandshakeReply } from "@speirsy11/llm-bench-harness-sdk";
import {
  decodeProtocolLine,
  encodeProtocolLine,
} from "@speirsy11/llm-bench-harness-sdk";

const request = decodeProtocolLine(await readOneLine());

const reply: HandshakeReply = {
  kind: "handshake_reply",
  protocolVersion: "1.0.0",
  manifest: {
    id: "acme-harness",
    name: "Acme Harness",
    version: "1.0.0",
    capabilities: ["workspaces", "shell"],
    modelRoutes: [{ id: "openai-gpt", provider: "openai", model: "gpt-4.1" }],
  },
};
process.stdout.write(encodeProtocolLine(reply));
```

Peers accept compatible `1.x.y` protocol messages. An unsupported major throws
`PluginProtocolVersionError`, whose message names both versions and instructs
the operator to update or reinstall the plugin.

## Credentials and local installation security

Plugins are installed by the runner operator, never by the dashboard. A run
request has a `credentials` record that defaults to `{}`. It contains only
individual credential values the runner explicitly grants to that job; a plugin
must not assume provider credentials, process environment variables, logs, or
workspace files contain secrets. Do not print credential values or include them
in events, errors, checkpoints, patches, or artifacts.

The SDK validates strict objects, so reject unknown fields instead of accepting
unreviewed protocol extensions. Treat the workspace root and every string in a
run request as untrusted input and enforce your own filesystem and command
boundaries before invoking local tools.

## Public API

- `PluginMessageSchema`, `HandshakeRequestSchema`, `HandshakeReplySchema`, and
  `RunRequestSchema` validate inbound protocol messages.
- `encodeProtocolLine` and `decodeProtocolLine` implement bounded JSONL.
- `assertCompatibleProtocolVersion` checks major compatibility.
- `assertValidRunTranscript` verifies contiguous events and exactly one
  terminal result after collecting a plugin's output.

## Publishing

`pnpm build` emits a bundled ESM runtime at `dist/index.js` and declarations
at `dist/index.d.ts`; the public export never points at TypeScript source.
`pnpm test:pack` builds the package, packs it, installs the tarball into a
fresh temporary consumer, and imports the published entrypoint.
