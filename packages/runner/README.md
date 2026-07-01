# @speirsy11/llm-bench-runner

The local macOS/Linux worker for LLMBench. It pairs to one hosted account,
leases one job at a time, runs the repository-repair tracer locally, buffers
events through network loss, uploads private artifacts directly to Vercel Blob,
and reports terminal state without exposing provider credentials.

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

## Local state

State defaults to `~/.llm-bench` and can be moved with
`LLMBENCH_RUNNER_HOME`. Credentials, key material, checkpoints, event spools,
and artifacts use owner-only filesystem permissions. Environment reports omit
hostnames, usernames, home directories, and absolute paths.

## Runtime contract

- Node 22 on macOS or Linux.
- Protocol `1.0`; incompatible majors fail before work starts.
- One active job per runner.
- Restarted work resumes only with a resumable checkpoint accepted by the
  harness. Otherwise it is marked interrupted and never spends again silently.
