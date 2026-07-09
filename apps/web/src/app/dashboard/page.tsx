import {
  cancelJobAction,
  launchExperimentAction,
  retryJobAction,
  saveCredentialProfileAction,
} from "@/app/dashboard/actions";
import { getDashboardActorSession } from "@/app/dashboard/auth";
import { defaultDashboardMatrix } from "@/app/dashboard/matrix";
import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const { actor, session } = await getDashboardActorSession();
  const controlPlane = getDashboardControlPlane();
  const [runners, credentialProfiles, experiments] = await Promise.all([
    controlPlane.dashboard.listRunners(actor),
    controlPlane.dashboard.listCredentialProfiles(actor),
    controlPlane.dashboard.listExperiments(actor),
  ]);
  const primaryRunner = runners[0] ?? null;
  const primaryCredential = credentialProfiles[0] ?? null;
  const preview =
    primaryRunner && primaryCredential
      ? await controlPlane.dashboard.previewExperiment(actor, {
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
