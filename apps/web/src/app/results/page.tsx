import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { PublicResultsIndex } from "@/components/public-results-index";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const results = await getDashboardControlPlane().publicResults.list();
  return <PublicResultsIndex results={results} />;
}
