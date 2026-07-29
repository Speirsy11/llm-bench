"use client";

import Link from "next/link";

export default function ResultsError({
  reset,
}: {
  readonly reset: () => void;
}) {
  return (
    <main className="bg-background text-foreground grid min-h-screen place-items-center px-5">
      <section
        aria-labelledby="results-error-heading"
        className="border-border bg-card max-w-xl rounded-3xl border p-8 text-center shadow-sm"
      >
        <p className="text-primary font-mono text-xs tracking-wider uppercase">
          Public result unavailable
        </p>
        <h1 className="mt-4 text-3xl font-semibold" id="results-error-heading">
          The evidence could not be loaded.
        </h1>
        <p className="text-muted-foreground mt-4 leading-7">
          No private data was exposed. Retry the sanitized snapshot request or
          return to the result library.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            className="bg-primary text-primary-foreground rounded-full px-5 py-3 font-semibold"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
          <Link
            className="border-border rounded-full border px-5 py-3 font-semibold"
            href="/results"
          >
            Result library
          </Link>
        </div>
      </section>
    </main>
  );
}
