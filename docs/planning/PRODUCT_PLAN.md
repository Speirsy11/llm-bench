# LLMBench product plan

Status: **approved**  
Change policy: product decisions in this document change only with explicit owner approval. Delivery progress belongs in `DELIVERY_PLAN.md` and the epic briefs.

## Product outcome

LLMBench is an agentic-first benchmarking platform for comparing a model, harness, and toolset as separate experimental variables. It also supports simpler response and performance benchmarks. The repository is both a useful open-source tool and a portfolio-quality demonstration of reproducible experimentation, secure local execution, typed architecture, and rigorous testing.

## User experience

1. An unsigned visitor sees curated real results and an editorial explanation of the methodology.
2. A user signs in to the hosted dashboard with GitHub OAuth.
3. The user installs a macOS or Linux runner, pairs it with a short device-code flow, and keeps it available for jobs.
4. The dashboard configures model routes, harnesses, toolsets, MCP profiles, credentials, and experiment matrices.
5. Every model invocation executes on the paired runner. The hosted application orchestrates work and stores results; it does not execute benchmarks.
6. The runner executes one job at a time, reports progress, uploads private artifacts, and removes temporary workspaces after terminal completion.
7. The dashboard leads with charts and distributions, with matrices, samples, trajectories, diffs, cases, and environment details available for inspection.

The CLI is an operational surface for pairing, runner lifecycle, diagnostics, capabilities, plugins, and MCP profiles. It does not provide dashboard parity or terminal-launched benchmarks in v1.

## Experimental model

A result is identified by the tuple `(benchmark version, model route, harness version, toolset version, runner environment)`.

- **Model route:** OpenRouter or a model selected by a native harness.
- **Harness:** LLMBench, Codex, Claude Code, Pi, or a locally installed plugin.
- **Toolset:** built-in repository tools and optional runner-installed MCP profiles.
- **Benchmark:** versioned response cases or agentic workspace tasks with deterministic grading.

Results expose typed metrics instead of forcing a universal score. Supported metric kinds include ratio, duration, rate, count, tokens, currency, and bytes. Each metric declares its unit and ranking direction, and a benchmark may nominate a primary metric.

Every invocation records available duration, TTFT, token usage, cost, errors, and harness metadata. A dedicated performance benchmark adds controlled warm-up, repeated samples, percentiles, throughput, and variance.

## Benchmark catalog

Agentic repository repair is the primary v1 benchmark. It contains three TypeScript and three Python tasks with versioned fixtures, visible context and tests, hidden behavioral tests introduced only after execution, and explicit constraints. Primary metrics include hidden-test pass ratio, regression status, constraint compliance, duration, cost, tool calls, and patch size.

Response benchmarks cover structured output and instruction following. Performance defaults to one warm-up plus five measured samples. Response cases default to three repetitions; agentic tasks default to one. Experiments schedule target combinations in round-robin order on a sequential runner.

## Harness architecture

The extension surface uses separate abstract classes for `Benchmark`, `ResponseBenchmark`, `AgenticBenchmark`, `HarnessAdapter`, `ProcessHarnessAdapter`, and `OpenAICompatibleModelProvider`.

- `OpenRouterProvider` extends the OpenAI-compatible provider base.
- `CodexHarness`, `ClaudeHarness`, and `PiHarness` extend the process harness base.
- `LLMBenchHarness` composes a model provider with a bounded agent loop and configured toolset.
- External plugins implement a versioned executable JSONL protocol; a TypeScript SDK provides the same vocabulary without importing plugin code into the runner process.

Harness manifests advertise capabilities such as response generation, workspaces, files, shell, structured output, streaming, session resume, MCP, and usage reporting. Unsupported benchmark/target combinations are rejected before a paid call.

Custom plugins and MCP servers are installed explicitly by the runner operator. The dashboard may select and configure advertised components but may never upload or install executable code.

## Control plane and runner

The dashboard uses framework-independent domain services. The external runner communicates over a versioned REST/JSON protocol with shared Zod schemas.

Jobs follow `queued → leased → preparing → running → grading → uploading → completed`, with failed, cancelled, and interrupted terminal states. Network loss causes local event buffering. A restarted process resumes only when its harness advertises resume support and a valid checkpoint exists; otherwise the job becomes interrupted. A fresh retry is always explicit and linked to the original job.

Runner environment records are privacy-safe: OS, architecture, CPU class, memory, runtime and harness versions, sandbox mode, and content hashes are retained; hostname, username, and absolute paths are omitted.

## Security and privacy

Provider API keys entered in the dashboard are encrypted in the browser to a selected runner public key. Postgres stores only runner-bound ciphertext and masked metadata. The intended runner decrypts a credential only for a job that references it. Codex and Claude continue to use their native local authentication.

Benchmark and task code never receives raw credentials. Secrets must not appear in job payloads, logs, errors, traces, or artifacts. MCP credentials remain runner-local.

All signed-in user results are private. Only an administrator allowlisted by GitHub identity can curate sanitized public sample results. Public samples compare one explicit OpenRouter model through LLMBench and Pi where possible, with separately labelled Codex and Claude configurations.

## Platform and storage

- Dashboard: Next.js on Vercel.
- Authentication: Auth.js with GitHub OAuth.
- Database: Neon Postgres with Drizzle migrations.
- Artifacts: private Vercel Blob using short-lived, job-scoped direct upload authorization.
- Runner: Node 22 on macOS and Linux.
- Packages: pnpm/Turborepo monorepo with enforced architectural boundaries.
- Published packages: `@speirsy11/llm-bench-runner` and `@speirsy11/llm-bench-harness-sdk`.

## Quality policy

Development follows vertical test-driven slices: one observable failing test, the minimum implementation, then refactoring while green. Tests target public behavior and use real repositories, graders, cryptography, and Postgres where relevant. Only external boundaries such as model HTTP calls, executable CLIs, clocks, and Blob transport are replaced by fixtures.

Coverage thresholds are 100% for foundations, services, benchmark features, runner engine, adapters, protocol, and cryptography; application and UI wiring require 90%. Generated migrations, configuration, type-only files, and barrel exports are the only planned exclusions. Codecov and CI artifacts expose coverage.

## Deferred scope

- Windows runners
- Hosted benchmark execution
- Automatic or dashboard-driven plugin installation
- Public result sharing by ordinary users
- LLM-as-judge grading
- Mandatory container execution
- Languages beyond TypeScript and Python
- CLI parity with the dashboard
