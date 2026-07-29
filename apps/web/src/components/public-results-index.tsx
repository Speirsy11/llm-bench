import Link from "next/link";

import type { PublicResultSummary } from "@llm-bench/control-plane";

export function PublicResultsIndex({
  results,
}: {
  readonly results: readonly PublicResultSummary[];
}) {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 lg:px-12">
        <header className="border-border flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <Link className="font-mono text-sm font-semibold" href="/">
            LLMBench
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link
              className="hover:text-primary py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/#methodology"
            >
              Open the methodology
            </Link>
            <Link
              className="bg-foreground text-background rounded-full px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/api/auth/signin"
            >
              Open workspace
            </Link>
          </div>
        </header>

        <section className="py-16 sm:py-24">
          <p className="text-primary font-mono text-xs tracking-[0.22em] uppercase">
            Sanitized, curated, inspectable
          </p>
          <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-balance sm:text-7xl">
            Public result library
          </h1>
          <p className="text-muted-foreground mt-7 max-w-2xl text-lg leading-8">
            Browse administrator-curated snapshots. Every result keeps its
            benchmark, target variables, sample count, missing data, and
            privacy-safe runner conditions attached.
          </p>
        </section>

        {results.length === 0 ? (
          <section className="border-border bg-card rounded-3xl border border-dashed p-8 sm:p-12">
            <p className="text-primary font-mono text-xs tracking-wider uppercase">
              Empty library
            </p>
            <h2 className="mt-4 text-2xl font-semibold">
              No curated results published yet
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl leading-7">
              The methodology preview remains available while an administrator
              verifies and sanitizes the first real comparison.
            </p>
            <Link
              className="decoration-primary/50 mt-6 inline-flex font-semibold underline underline-offset-4"
              href="/#methodology"
            >
              Open the methodology
            </Link>
          </section>
        ) : (
          <section
            aria-label="Curated results"
            className="grid gap-5 pb-16 md:grid-cols-2"
          >
            {results.map((result) => (
              <PublicResultCard key={result.id} result={result} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

export function PublicResultCard({
  result,
}: {
  readonly result: PublicResultSummary;
}) {
  return (
    <article className="border-border bg-card rounded-2xl border p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-primary font-mono text-[11px] tracking-[0.16em] uppercase">
        Curated snapshot
      </p>
      <h2 className="mt-4 text-2xl font-semibold">{result.name}</h2>
      <p className="text-muted-foreground mt-3 text-sm">
        {result.resultCount} result{result.resultCount === 1 ? "" : "s"} ·{" "}
        {formatDate(result.curatedAt)}
      </p>
      <ul className="mt-5 flex flex-wrap gap-2" aria-label="Benchmarks">
        {result.benchmarkIds.map((benchmark) => (
          <li
            className="bg-muted rounded-full px-3 py-1 text-xs"
            key={benchmark}
          >
            {humanize(benchmark)}
          </li>
        ))}
      </ul>
      <Link
        aria-label={`Inspect ${result.name}`}
        className="text-primary mt-7 inline-flex font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        href={`/results/${result.id}`}
      >
        Inspect charts and evidence →
      </Link>
    </article>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanize(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
