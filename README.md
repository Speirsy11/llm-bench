# LLMBench

LLMBench is an agentic-first benchmarking platform for comparing models, harnesses, and toolsets under reproducible conditions.

The project is in its workspace-foundation state (EPIC-01). The `tooling/` and `turbo/` directories provide the shared quality baseline used by every future product package.

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

Every package uses the `@llm-bench` npm scope. Scaffold new packages with `pnpm turbo gen init`.

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
