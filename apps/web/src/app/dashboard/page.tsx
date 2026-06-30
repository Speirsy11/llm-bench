import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user.id || !session.user.githubLogin) {
    redirect("/api/auth/signin?callbackUrl=%2Fdashboard");
  }

  return (
    <DashboardShell
      githubLogin={session.user.githubLogin}
      name={session.user.name ?? session.user.githubLogin}
    />
  );
}
