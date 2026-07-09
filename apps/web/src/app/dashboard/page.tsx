import { redirect } from "next/navigation";
import {
  cancelJobAction,
  launchExperimentAction,
  retryJobAction,
  saveCredentialProfileAction,
} from "@/app/dashboard/actions";
import { defaultDashboardMatrix } from "@/app/dashboard/matrix";
import { dashboardControlPlane } from "@/app/dashboard/runtime";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user.id || !session.user.githubLogin) {
    redirect("/api/auth/signin?callbackUrl=%2Fdashboard");
  }
  const actor = {
    userId: session.user.id,
    githubLogin: session.user.githubLogin,
    isAdmin: false,
  };
  const [runners, credentialProfiles, experiments] = await Promise.all([
    dashboardControlPlane.dashboard.listRunners(actor),
    dashboardControlPlane.dashboard.listCredentialProfiles(actor),
    dashboardControlPlane.dashboard.listExperiments(actor),
  ]);
  const primaryRunner = runners[0] ?? null;
  const primaryCredential = credentialProfiles[0] ?? null;
  const preview =
    primaryRunner && primaryCredential
      ? await dashboardControlPlane.dashboard.previewExperiment(actor, {
          name: "Repository repair",
          runnerId: primaryRunner.id,
          credentialProfileId: primaryCredential.id,
          ...defaultDashboardMatrix(),
        })
      : null;

  return (
    <DashboardShell
      cancelJobAction={cancelJobAction}
      credentialProfiles={credentialProfiles}
      experiments={experiments}
      githubLogin={session.user.githubLogin}
      launchExperimentAction={launchExperimentAction}
      name={session.user.name ?? session.user.githubLogin}
      preview={preview}
      retryJobAction={retryJobAction}
      runners={runners}
      saveCredentialProfileAction={saveCredentialProfileAction}
    />
  );
}
