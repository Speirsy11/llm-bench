# @speirsy11/llm-bench-runner

The local macOS/Linux worker for LLMBench. It pairs to one hosted account,
leases one job at a time through protocol `3.0`, runs repository-repair work in
an ephemeral workspace, buffers events through network loss, uploads private
artifacts directly to Vercel Blob, and reports terminal state without exposing
provider credentials.

## Setup from a workspace checkout

Use Node 22 or newer on macOS or Linux, install the pinned workspace
dependencies, and build the runner:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm --filter @speirsy11/llm-bench-runner build
```

The build emits the self-contained `packages/runner/dist/cli.cjs`; private
workspace packages are bundled rather than required as runtime installations.
The examples below use the installed `llm-bench-runner` binary. From a workspace
checkout, replace it with `node packages/runner/dist/cli.cjs`.

## Commands

```bash
llm-bench-runner login https://your-llmbench.example workstation
llm-bench-runner start
llm-bench-runner status
llm-bench-runner doctor
llm-bench-runner capabilities
llm-bench-runner stop
llm-bench-runner logout
```

`login` prints a short-lived device code. Open the displayed authenticated URL,
approve that code, then start the worker. `logout` revokes the server-side token
before deleting local credentials.

Create OpenRouter credential profiles only after pairing the destination runner:
the dashboard seals each key to that runner's public key. Codex and Claude jobs
instead require their native CLI to be installed, available on `PATH`, and
already authenticated for the same local user that runs LLMBench. Pi supports
response-mode adapter contracts but intentionally rejects repository-repair
agentic leases before process start.

### Local plugins

Installation is an explicit runner-operator action. The dashboard can select
only what this runner advertises; it cannot upload or install executable code.

```bash
llm-bench-runner plugin probe /absolute/path/to/plugin
llm-bench-runner plugin add /absolute/path/to/plugin
llm-bench-runner plugin list
llm-bench-runner plugin grant example-harness-plugin API_TOKEN RUNNER_API_TOKEN
llm-bench-runner plugin revoke example-harness-plugin API_TOKEN
llm-bench-runner plugin remove example-harness-plugin
```

`add` accepts exactly one self-contained executable artifact (no interpreter or
script arguments), resolves its real path, requires an executable regular file,
performs a credential-free protocol handshake, and records its SHA-256 identity
and sanitized manifest. The executable is re-hashed before every job. Grant
commands map a plugin request name to one exact environment-variable name; they
never store or display its value. An unresolved grant fails before the plugin
starts. Plugins receive neither the runner environment nor native harness
authentication.

The SDK is documented in
[`packages/harness-sdk/README.md`](../harness-sdk/README.md), with a complete
local executable in
[`packages/example-harness-plugin`](../example-harness-plugin).

### Runner-installed MCP profiles

Create an owner-controlled JSON file without a `contentHash`; the registry
computes a stable hash from the complete profile:

```json
{
  "metadata": {
    "protocolVersion": "1",
    "id": "filesystem",
    "version": "1.0.0",
    "label": "Filesystem",
    "description": "Pinned local filesystem MCP server",
    "capabilities": ["tools"],
    "tools": ["read_file"]
  },
  "local": {
    "argv": ["/absolute/path/to/mcp-server", "--stdio"],
    "secretReferences": {}
  }
}
```

```bash
llm-bench-runner mcp add ./filesystem-profile.json
llm-bench-runner mcp grant filesystem MCP_TOKEN RUNNER_MCP_TOKEN
llm-bench-runner mcp list
llm-bench-runner mcp probe filesystem
llm-bench-runner mcp capabilities filesystem
llm-bench-runner mcp start filesystem
llm-bench-runner mcp stop filesystem
llm-bench-runner mcp revoke filesystem MCP_TOKEN
llm-bench-runner mcp remove filesystem
```

Profiles are stdio-only. Imported JSON must have an empty `secretReferences`
object. Grant each server environment name to a runner environment variable
locally with `mcp grant`; only then may that profile resolve it from the runner
environment. `HOME`, `CODEX_HOME`, process launch variables, provider
credentials, executable arguments, and secret references are never advertised
to the control plane. `probe`,
`capabilities`, and `start` are bounded start/probe/stop operations; MCP
processes are otherwise job-owned and always stopped after completion,
failure, cancellation, or partial startup. There is no untracked persistent MCP
daemon for a later CLI process to inherit. A selected plugin receives only a
job-scoped owner-only Unix socket descriptor; the runner bridges JSON-RPC to the
initialized stdio server and removes the socket when the job ends.

Stop the runner before changing extensions and restart it afterwards so its
pairing/heartbeat inventory is a stable snapshot for leased jobs.

## Local state

State defaults to `~/.llm-bench` and can be moved with
`LLMBENCH_RUNNER_HOME`. Credentials, key material, checkpoints, event spools,
and artifacts use owner-only filesystem permissions. Environment reports omit
hostnames, usernames, home directories, and absolute paths.

The runner stores canonical raw 32-byte X25519 public and private keys as Base64.
State produced by the earlier DER key format is intentionally rejected. To
re-pair, stop the runner, preserve the old file as a backup, and log in again:

```bash
llm-bench-runner stop
mv ~/.llm-bench/credentials.json ~/.llm-bench/credentials.json.der-backup
llm-bench-runner login https://your-llmbench.example workstation
```

Use the corresponding `LLMBENCH_RUNNER_HOME` path when it is configured. Any
credential profile sealed to the old key must be recreated for the new runner
key before an LLMBench/OpenRouter job can run.

## Runtime contract

- Node 22 on macOS or Linux.
- Protocol `3.0`; older or otherwise incompatible payloads fail validation
  before work starts. The HTTP route remains under `/api/v1/runner/`.
- Protocol-2 pairings are disabled by the protocol-3 migration because they
  cannot advertise immutable plugin/MCP inventory. Update the runner, log out,
  log in to create a new pairing, then recreate any credential profile sealed
  to the previous runner key.
- One active job per runner.
- Every lease carries the selected repository task and fixture/grader hashes,
  model route, harness manifest, toolset, execution limits, and optional sealed
  credential. Local hashes and target compatibility are checked before a
  provider request or native process starts.
- LLMBench requires the explicit `read_file`, `list_directory`, `search_files`,
  and `apply_patch` toolset, no MCP profiles, an OpenRouter route, and a
  credential sealed to this runner. Leased turn, tool-call, and duration limits
  bound the loop; `maxTokens` is sent as the provider request's response-token
  ceiling.
- Codex and Claude use their native local authentication. They receive the
  selected task, route, model, toolset policy, limits, and resumable checkpoint,
  but no OpenRouter credential or ciphertext.
- Pi rejects agentic repository repair before process start.
- Restarted work resumes only with a resumable checkpoint accepted by the
  harness. Otherwise it is marked interrupted and never spends again silently.

## Grading boundary

Hidden tests are absent while the harness edits the workspace. Grading then
runs repaired code in a disposable child process with a credential-free
environment, output and time limits, and cancellation. Limit violations
terminate the grader process group. Node grading uses the Node permission model
to restrict filesystem access to the workspace and temporary grader directory.

This boundary keeps model-authored code out of the long-lived runner process,
but it is not a hostile-code sandbox. Python has no equivalent permission model,
and network denial or stronger filesystem isolation must be supplied by the
surrounding runner environment before executing untrusted work.

## Troubleshooting

- `Runner state file credentials.json is invalid` usually means legacy DER key
  state or corruption. Stop the runner, move the file aside as shown above, and
  pair again. Recreate credentials sealed to the previous public key.
- A protocol validation error means the runner and hosted control plane do not
  agree on protocol `3.0`. Update both sides; incompatible leases are not run.
- `doctor` checks the supported OS, Node version, login state, and control-plane
  heartbeat. It does not authenticate native harness CLIs; verify Codex or
  Claude directly under the runner's local user.
- `executable changed after installation` or `no longer matches the leased
immutable identity` means local extension state drifted after advertisement.
  Stop the runner, remove and re-add the extension, then restart it; never
  bypass the hash check.
- LLMBench failures before an OpenRouter request commonly indicate a local
  fixture/grader hash mismatch, an incompatible route or toolset, a missing
  credential, or a credential sealed to another runner. Re-pair or update the
  runner corpus rather than bypassing validation.
- A restarted job without a target-supported resumable checkpoint is completed
  as `interrupted`. A terminal request that cannot reach the server remains in
  local state and is retried without rerunning the benchmark.
