import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { LandingShell } from "@/components/landing-shell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const results = await getDashboardControlPlane().publicResults.list();
  return <LandingShell results={results} />;
}
