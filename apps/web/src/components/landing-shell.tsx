import Link from "next/link";

const methodology = [
  {
    eyebrow: "Primary benchmark",
    title: "Agentic repository repair",
    description:
      "Versioned TypeScript and Python workspaces are graded with hidden behavioral tests after each run.",
  },
  {
    eyebrow: "Experimental control",
    title: "Separate every variable",
    description:
      "Model routes, harness versions, toolsets, and runner environments remain explicit in every result.",
  },
  {
    eyebrow: "Evidence",
    title: "Inspect more than a score",
    description:
      "Compare pass ratios, regressions, duration, cost, tool calls, patch size, and private run artifacts.",
  },
] as const;

export function LandingShell() {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="border-border flex items-center justify-between border-b pb-6">
          <Link
            className="font-mono text-sm font-semibold tracking-tight"
            href="/"
          >
            LLMBench
          </Link>
          <Link
            className="border-border bg-card hover:border-foreground/20 rounded-full border px-4 py-3 text-sm font-medium shadow-xs transition focus-visible:outline-2 focus-visible:outline-offset-4"
            href="/api/auth/signin"
          >
            Sign in with GitHub
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-16 py-20 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-primary mb-5 font-mono text-xs tracking-[0.22em] uppercase">
              Reproducible agent evaluation
            </p>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-balance sm:text-6xl lg:text-7xl">
              Compare models, harnesses, and tools separately.
            </h1>
            <p className="text-muted-foreground mt-7 max-w-2xl text-lg leading-8 text-pretty">
              LLMBench keeps the experimental variables visible, executes every
              benchmark on your paired runner, and preserves enough evidence to
              explain why one configuration won.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                className="bg-primary text-primary-foreground rounded-full px-5 py-3 text-sm font-semibold shadow-sm transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4"
                href="/api/auth/signin"
              >
                Sign in with GitHub
              </Link>
              <a
                className="text-muted-foreground hover:text-foreground px-2 py-3 text-sm font-medium transition"
                href="#methodology"
              >
                Read the methodology ↓
              </a>
            </div>
          </div>

          <aside className="border-border bg-card rounded-[2rem] border p-7 shadow-xl">
            <div className="border-border flex items-center justify-between border-b pb-5">
              <div>
                <p className="text-sm font-medium">Curated public result</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Repository repair · fixture v1
                </p>
              </div>
              <span className="bg-secondary text-secondary-foreground rounded-full px-3 py-1 font-mono text-[11px]">
                SAMPLE
              </span>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4">
              <Metric label="Hidden tests" value="6 / 6" />
              <Metric label="Regressions" value="0" />
              <Metric label="Duration" value="42.8s" />
              <Metric label="Patch" value="+18 −4" />
            </dl>
            <p className="bg-muted text-muted-foreground mt-6 rounded-2xl p-4 font-mono text-xs leading-5">
              Model route, harness, toolset, benchmark version, and runner
              environment remain attached to every observation.
            </p>
          </aside>
        </section>

        <section
          className="border-border bg-border grid gap-px overflow-hidden rounded-3xl border md:grid-cols-3"
          id="methodology"
        >
          {methodology.map((item) => (
            <article className="bg-card p-7" key={item.title}>
              <p className="text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
                {item.eyebrow}
              </p>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">
                {item.title}
              </h2>
              <p className="text-muted-foreground mt-3 text-base leading-7">
                {item.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border rounded-2xl border p-4">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-2 font-mono text-lg font-semibold">{value}</dd>
    </div>
  );
}
