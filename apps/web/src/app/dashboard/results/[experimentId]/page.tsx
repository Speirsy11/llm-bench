import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboardActor } from "@/app/dashboard/auth";
import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { PublicResultShell } from "@/components/public-result-shell";

export const dynamic = "force-dynamic";

export default async function PrivateResultPage({
  params,
}: {
  readonly params: Promise<{ readonly experimentId: string }>;
}) {
  const actor = await getDashboardActor();
  const { experimentId } = await params;
  const analysis =
    await getDashboardControlPlane().publicResults.previewAnalysis(
      actor,
      experimentId,
    );
  if (analysis === null) notFound();
  if (analysis.view === null) {
    return <PrivateAnalysisState blockers={analysis.blockers} />;
  }
  return (
    <>
      {analysis.blockers.length > 0 ? (
        <AnalysisWarning blockers={analysis.blockers} />
      ) : null}
      <PublicResultShell context="private" result={analysis.view} />
    </>
  );
}

function PrivateAnalysisState({
  blockers,
}: {
  readonly blockers: readonly string[];
}) {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
          Private analysis
        </p>
        <h1 className="mt-4 text-4xl font-semibold">
          Charts are not available yet
        </h1>
        <p className="text-muted-foreground mt-4">
          The experiment remains private. Resolve the evidence conditions below
          before a complete analysis can be rendered.
        </p>
        <AnalysisWarning blockers={blockers} />
        <Link
          className="border-border mt-6 inline-flex rounded-md border px-4 py-2 text-sm font-semibold"
          href="/dashboard"
        >
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}

function AnalysisWarning({
  blockers,
}: {
  readonly blockers: readonly string[];
}) {
  return (
    <section
      aria-labelledby="partial-analysis-title"
      className="border-warning/40 bg-warning/10 text-foreground mx-auto my-4 max-w-6xl rounded-lg border px-6 py-4"
    >
      <h2 className="font-semibold" id="partial-analysis-title">
        Partial analysis
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    </section>
  );
}
