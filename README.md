# LLMBench

LLMBench is an agentic-first benchmarking platform for comparing models,
harnesses, and toolsets under reproducible conditions.

The `tooling/` and `turbo/` directories provide the shared quality baseline used
by every package. The product is split into provider-neutral contracts, a hosted
control plane and dashboard, a local runner, repository-repair fixtures and
grading, and interchangeable harness adapters. Runner protocol `2.0` leases an
immutable workload, target, toolset, limits, and runner-bound credential. The
runner validates those inputs against its local corpus before selecting
LLMBench, Codex, or Claude; Pi currently rejects agentic work before process
start.

LLMBench/OpenRouter credentials are sealed in the browser to the selected
runner's raw X25519 public key. The hosted application stores and leases only
ciphertext. Plaintext is opened in memory by that runner and revealed only to
the selected provider transport. Codex and Claude continue to use their native
local authentication and never receive the OpenRouter ciphertext.

Repository repair runs in an ephemeral, path-contained workspace with explicit
tool, turn, token, and duration limits. Hidden TypeScript and Python grading
runs after the harness in a disposable child process with a credential-scrubbed
environment, bounded output, cancellation, and timeout. This protects the
long-lived runner from grader crashes; limit violations terminate the grader
process group. It is not a hostile-code sandbox: Python lacks Node's permission
model, and network denial remains the responsibility of the surrounding runner
environment.

## Prerequisites

- **Node** `22.21.0` (pinned in [`.nvmrc`](.nvmrc); run `nvm use`)
- **pnpm** `10.19.0` (pinned via `packageManager`; enable with `corepack enable`)

A clean clone installs reproducibly with:

```bash
pnpm install --frozen-lockfile
```

## Local runner quick start

Build and pair the runner from a workspace checkout:

```bash
pnpm --filter @speirsy11/llm-bench-runner build
node packages/runner/dist/cli.cjs login https://your-llmbench.example workstation
node packages/runner/dist/cli.cjs start
node packages/runner/dist/cli.cjs doctor
```

The runner supports macOS and Linux with Node 22 or newer. See the
[runner operations guide](packages/runner/README.md) for local state, native
harness prerequisites, protocol-v2 migration, and troubleshooting. See the
[crypto package guide](packages/crypto/README.md) for the browser-sealing and
plaintext boundaries.

## Workspace layout

Packages are organised by architectural boundary, enforced by `pnpm boundaries`:

| Tag           | Allowed dependencies                               |
| ------------- | -------------------------------------------------- |
| `foundation`  | foundation, tooling                                |
| `service`     | foundation, tooling                                |
| `feature`     | foundation, service, tooling                       |
| `composition` | foundation, service, feature, tooling              |
| `app`         | foundation, service, feature, composition, tooling |
| `tooling`     | tooling                                            |

Internal packages use the `@llm-bench` npm scope. The explicitly published runner and harness SDK use the `@speirsy11` scope. Scaffold new internal packages with `pnpm turbo gen init`.

## Commands

| Command                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `pnpm format`               | Prettier check across the workspace           |
| `pnpm lint`                 | ESLint across the workspace                   |
| `pnpm lint:ws`              | Sherif workspace consistency checks           |
| `pnpm typecheck`            | Strict TypeScript project checks              |
| `pnpm boundaries`           | Turbo dependency-boundary enforcement         |
| `pnpm test`                 | Vitest suites                                 |
| `pnpm test:coverage`        | Vitest suites with V8 coverage and thresholds |
| `pnpm test:fixtures`        | Repository-repair fixture corpus tests        |
| `pnpm test:integration`     | Real PostgreSQL integration suites            |
| `pnpm test:runner-contract` | Runner, Codex, Claude, and Pi contracts       |
| `pnpm db:migrate`           | Apply checked-in Drizzle migrations           |
| `pnpm db:test:reset`        | Reset only a database explicitly named test   |
| `pnpm build`                | Turbo build graph                             |
| `pnpm clean`                | Remove installed dependencies                 |

## Coverage policy

Coverage uses the V8 provider with `text` and `lcov` reporters. Core packages
(`foundation`, `service`, `feature`, `composition`, `tooling`) enforce **100%**
statement, branch, function, and line coverage. Application packages enforce
**90%**. Documented exclusions: test files (`**/*.test.ts`), config files
(`**/*.config.*`), generator templates, and the config-only `@llm-bench/tsconfig`
package. Live paid-provider tests are opt-in and never gate ordinary coverage.

## License

MIT
