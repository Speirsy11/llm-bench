# LLMBench

LLMBench is an agentic-first benchmarking platform for comparing models, harnesses, and toolsets under reproducible conditions.

The `tooling/` and `turbo/` directories provide the shared quality baseline used by every product package. `@llm-bench/contracts` (EPIC-02) defines the provider-neutral vocabulary — benchmarks, harnesses, metrics, manifests, events, and the versioned wire protocol — that every later package builds on. `@llm-bench/runner-engine` and `@llm-bench/repository-repair` (EPIC-03) prove one repository-repair task end to end locally: an ephemeral, path-contained workspace runs a deterministic harness, hidden tests grade the result independently, and the workspace is cleaned up. `@llm-bench/control-plane` and `@llm-bench/web` (EPIC-04) add Neon persistence, Auth.js GitHub identity, owner-only private records, administrator curation, and the public/private application shells. `@speirsy11/llm-bench-runner` (EPIC-05) adds device-code pairing, a durable one-job worker, versioned runner HTTP endpoints, and private direct artifact uploads. `@llm-bench/crypto`, `@llm-bench/openai-compatible`, and `@llm-bench/llm-bench-harness` (EPIC-06) add runner-bound sealed credentials and the built-in bounded agent. `@llm-bench/process-harness` and `@llm-bench/codex-harness` (EPIC-09) add bounded subprocess execution and Codex response, workspace, and resume support through the common harness contract.

## Prerequisites

- **Node** `22.21.0` (pinned in [`.nvmrc`](.nvmrc); run `nvm use`)
- **pnpm** `10.19.0` (pinned via `packageManager`; enable with `corepack enable`)

A clean clone installs reproducibly with:

```bash
pnpm install --frozen-lockfile
```

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

| Command              | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `pnpm format`        | Prettier check across the workspace           |
| `pnpm lint`          | ESLint across the workspace                   |
| `pnpm lint:ws`       | Sherif workspace consistency checks           |
| `pnpm typecheck`     | Strict TypeScript project checks              |
| `pnpm boundaries`    | Turbo dependency-boundary enforcement         |
| `pnpm test`          | Vitest suites                                 |
| `pnpm test:coverage` | Vitest suites with V8 coverage and thresholds |
| `pnpm test:integration` | Real PostgreSQL integration suites         |
| `pnpm test:runner-contract` | Runner and Codex process contracts    |
| `pnpm db:migrate`    | Apply checked-in Drizzle migrations           |
| `pnpm db:test:reset` | Reset only a database explicitly named test   |
| `pnpm build`         | Turbo build graph                             |
| `pnpm clean`         | Remove installed dependencies                 |

## Coverage policy

Coverage uses the V8 provider with `text` and `lcov` reporters. Core packages
(`foundation`, `service`, `feature`, `composition`, `tooling`) enforce **100%**
statement, branch, function, and line coverage. Application packages enforce
**90%**. Documented exclusions: test files (`**/*.test.ts`), config files
(`**/*.config.*`), generator templates, and the config-only `@llm-bench/tsconfig`
package. Live paid-provider tests are opt-in and never gate ordinary coverage.

## License

MIT
