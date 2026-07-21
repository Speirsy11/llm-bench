import type { DashboardHarnessPreviews } from "@/components/experiment-matrix";
import {
  cancelJobAction,
  launchExperimentAction,
  retryJobAction,
  saveCredentialProfileAction,
} from "@/app/dashboard/actions";
import { getDashboardActorSession } from "@/app/dashboard/auth";
import {
  DASHBOARD_HARNESS_IDS,
  dashboardMatrixForHarness,
} from "@/app/dashboard/matrix";
import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { DashboardShell } from "@/components/dashboard-shell";

import { nativeHarnessCliBlocker } from "@llm-bench/contracts";

interface DashboardPageProps {
  readonly searchParams?: Promise<{
    readonly runnerId?: string | readonly string[];
  }>;
}

export default async function DashboardPage({
  searchParams = Promise.resolve({}),
}: DashboardPageProps = {}) {
  const { actor, session } = await getDashboardActorSession();
  const controlPlane = getDashboardControlPlane();
  const [params, runners, credentialProfiles, experiments] = await Promise.all([
    searchParams,
    controlPlane.dashboard.listRunners(actor),
    controlPlane.dashboard.listCredentialProfiles(actor),
    controlPlane.dashboard.listExperiments(actor),
  ]);
  const requestedRunnerId =
    typeof params.runnerId === "string" ? params.runnerId : null;
  const selectedRunner =
    runners.find(({ id }) => id === requestedRunnerId) ??
    runners.find(({ status }) => status === "online") ??
    runners[0] ??
    null;
  const selectedCredential =
    credentialProfiles.find(
      ({ runnerId }) => runnerId === selectedRunner?.id,
    ) ?? null;
  const previews: DashboardHarnessPreviews = {};
  if (selectedRunner) {
    const enabledHarnesses = DASHBOARD_HARNESS_IDS.filter((harnessId) =>
      harnessId === "llmbench"
        ? selectedCredential !== null
        : nativeHarnessCliBlocker(
            harnessId,
            selectedRunner.environment.harnessVersions,
          ) === null,
    );
    const entries = await Promise.all(
      enabledHarnesses.map(async (harnessId) => {
        const preview = await controlPlane.dashboard.previewExperiment(actor, {
          name: "Repository repair",
          runnerId: selectedRunner.id,
          ...(harnessId === "llmbench" && selectedCredential
            ? { credentialProfileId: selectedCredential.id }
            : {}),
          ...dashboardMatrixForHarness(harnessId),
        });
        return [harnessId, preview] as const;
      }),
    );
    Object.assign(previews, Object.fromEntries(entries));
  }

  return (
    <DashboardShell
      cancelJobAction={cancelJobAction}
      credentialProfiles={credentialProfiles}
      experiments={experiments}
      githubLogin={session.user.githubLogin}
      launchExperimentAction={launchExperimentAction}
      name={session.user.name ?? session.user.githubLogin}
      previews={previews}
      retryJobAction={retryJobAction}
      runners={runners}
      saveCredentialProfileAction={saveCredentialProfileAction}
      selectedRunnerId={selectedRunner?.id ?? null}
    />
  );
}
