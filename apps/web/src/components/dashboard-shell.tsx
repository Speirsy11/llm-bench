import Link from "next/link";

export function DashboardShell({
  githubLogin,
  name,
}: {
  readonly githubLogin: string;
  readonly name: string;
}) {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
        <header className="border-border flex items-center justify-between border-b pb-6">
          <div className="flex items-center gap-4">
            <Link className="font-mono text-sm font-semibold" href="/">
              LLMBench
            </Link>
            <span className="bg-secondary text-secondary-foreground rounded-full px-3 py-1 font-mono text-[10px] tracking-wider uppercase">
              Private workspace
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground hidden sm:inline">
              @{githubLogin}
            </span>
            <Link
              className="hover:text-primary py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/api/auth/signout"
            >
              Sign out
            </Link>
          </div>
        </header>

        <section className="py-14">
          <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
            Control plane
          </p>
          <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Good to see you, {name}.
              </h1>
              <p className="text-muted-foreground mt-4 max-w-2xl">
                This shell is ready for the paired runner and experiment flows
                introduced in the next delivery slices.
              </p>
            </div>
            <div className="bg-muted text-muted-foreground rounded-full px-5 py-3 font-mono text-xs tracking-wide uppercase">
              No active jobs
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-3">
          <DashboardCard eyebrow="Runner" title="No paired runner yet">
            Runner pairing and lifecycle controls will live here. The hosted
            dashboard never executes benchmark workloads.
          </DashboardCard>
          <DashboardCard eyebrow="Experiments" title="Nothing queued">
            Your private experiment configurations and recent run state will be
            visible in this workspace.
          </DashboardCard>
          <DashboardCard eyebrow="Public samples" title="Curation is protected">
            Only the configured GitHub administrator can publish a sanitized
            result to the public catalog.
          </DashboardCard>
        </section>
      </div>
    </main>
  );
}

function DashboardCard({
  children,
  eyebrow,
  title,
}: {
  readonly children: string;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <article className="border-border bg-card min-h-56 rounded-3xl border p-6 shadow-sm">
      <p className="text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-8 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-3 text-base leading-7">
        {children}
      </p>
    </article>
  );
}
