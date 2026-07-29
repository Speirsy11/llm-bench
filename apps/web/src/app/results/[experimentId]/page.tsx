import { notFound } from "next/navigation";
import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { PublicResultShell } from "@/components/public-result-shell";

export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  readonly params: Promise<{ readonly experimentId: string }>;
}) {
  const { experimentId } = await params;
  const result =
    await getDashboardControlPlane().publicResults.get(experimentId);
  if (result === null) notFound();
  return <PublicResultShell result={result} />;
}
