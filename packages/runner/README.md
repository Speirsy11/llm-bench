# @speirsy11/llm-bench-runner

The local macOS/Linux worker for LLMBench. It pairs to one hosted account,
leases one job at a time through protocol `2.0`, runs repository-repair work in
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
- Protocol `2.0`; older or otherwise incompatible payloads fail validation
  before work starts. The HTTP route remains under `/api/v1/runner/`.
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
  agree on protocol `2.0`. Update both sides; incompatible leases are not run.
- `doctor` checks the supported OS, Node version, login state, and control-plane
  heartbeat. It does not authenticate native harness CLIs; verify Codex or
  Claude directly under the runner's local user.
- LLMBench failures before an OpenRouter request commonly indicate a local
  fixture/grader hash mismatch, an incompatible route or toolset, a missing
  credential, or a credential sealed to another runner. Re-pair or update the
  runner corpus rather than bypassing validation.
- A restarted job without a target-supported resumable checkpoint is completed
  as `interrupted`. A terminal request that cannot reach the server remains in
  local state and is retried without rerunning the benchmark.
