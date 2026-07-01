# @llm-bench/control-plane

Framework-independent identity, persistence, and access services for the hosted
LLMBench application.

## Access invariants

- Public experiments are readable without a session.
- Private experiments return the same `null` result to anonymous and non-owner
  callers, so the API does not disclose whether a private identifier exists.
- Only an experiment owner may mutate it.
- Only an `AuthContext` derived from the GitHub administrator allowlist may
  publish a curated experiment.

Next.js handlers should translate Auth.js sessions into `AuthContext` and call
these services. Authorization does not belong in route handlers.

## Database

Drizzle schema and forward-only migrations cover Auth.js users/accounts/sessions,
runners, pairings, runner events, experiments, targets, jobs, attempts, results,
metrics, and artifacts. Runner tokens are stored only as SHA-256 hashes; pairing
codes expire and can deliver a token only once. Lease selection uses a locked,
skip-locked transaction so concurrent runners cannot claim the same job.
The migration sequence introduced by EPIC-04 is:

1. `0000_identity-experiments.sql`
2. `0001_control-plane-schema.sql`
3. `0002_unique-user-email.sql`
4. `0003_worried_prism.sql`
5. `0004_violet_miss_america.sql`
6. `0005_boring_mathemanic.sql`

Apply production/development migrations with:

```bash
DATABASE_URL=postgresql://... pnpm db:migrate
```

Integration tests require a disposable PostgreSQL database whose name contains
`test`:

```bash
export TEST_DATABASE_URL=postgresql://llmbench:llmbench@localhost:5432/llmbench_test
pnpm db:test:reset
pnpm test:integration
```

The reset guard deliberately refuses any database name not marked for tests.
