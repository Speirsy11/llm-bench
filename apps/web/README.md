# @llm-bench/web

The public LLMBench landing page and authenticated control-plane shell.

## Local GitHub OAuth and Neon setup

1. Create a GitHub OAuth app with homepage `http://localhost:3000` and callback
   URL `http://localhost:3000/api/auth/callback/github`.
2. Create a Neon Postgres project and copy its pooled connection string.
3. Copy the repository `.env.example` to `.env` and set:
   - `AUTH_SECRET` to a random value of at least 32 characters (for example,
     `openssl rand -base64 32`).
   - `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` from the OAuth app.
   - `DATABASE_URL` to the Neon connection string.
   - `LLMBENCH_ADMIN_GITHUB_LOGINS` to a comma-separated allowlist.
4. Apply migrations and start the app:

```bash
pnpm db:migrate
pnpm --filter @llm-bench/web dev
```

The dashboard is private. The landing page and administrator-curated experiment
records remain public. Every benchmark will execute on a paired runner in later
epics; this hosted application never runs benchmark workloads.
