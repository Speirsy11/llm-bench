export default function ResultsLoading() {
  return (
    <main
      aria-label="Loading public results"
      aria-live="polite"
      className="bg-background text-foreground min-h-screen"
    >
      <div className="mx-auto max-w-6xl animate-pulse px-5 py-16 sm:px-8">
        <div className="bg-muted h-4 w-36 rounded" />
        <div className="bg-muted mt-8 h-14 max-w-3xl rounded-2xl" />
        <div className="bg-muted mt-5 h-6 max-w-xl rounded" />
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="bg-muted h-64 rounded-3xl" />
          <div className="bg-muted h-64 rounded-3xl" />
        </div>
        <span className="sr-only">Loading curated result snapshots…</span>
      </div>
    </main>
  );
}
