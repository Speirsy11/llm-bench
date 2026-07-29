import type { DashboardHarnessPreviews } from "@/components/experiment-matrix";
import {
  cancelJobAction,
  curateExperimentAction,
  launchExperimentAction,
  retryJobAction,
  saveCredentialProfileAction,
  withdrawExperimentAction,
} from "@/app/dashboard/actions";
import { getDashboardActorSession } from "@/app/dashboard/auth";
import {
  DASHBOARD_HARNESS_IDS,
  dashboardMatrixForHarness,
} from "@/app/dashboard/matrix";
import { getDashboardControlPlane } from "@/app/dashboard/runtime";
import { DashboardShell } from "@/components/dashboard-shell";

import { nativeHarnessCliBlocker } from "@llm-bench/contracts";
import { benchmarkCatalog } from "@llm-bench/control-plane";

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
    const enabledHarnesses = [
      ...DASHBOARD_HARNESS_IDS.filter((harnessId) =>
        harnessId === "llmbench"
          ? selectedCredential !== null
          : nativeHarnessCliBlocker(
              harnessId,
              selectedRunner.environment.harnessVersions,
            ) === null,
      ),
      ...selectedRunner.inventory.plugins
        .map(({ manifest }) => manifest.id)
        .filter((id) => !DASHBOARD_HARNESS_IDS.includes(id as never)),
    ];
    const entries = await Promise.all(
      benchmarkCatalog.flatMap((benchmark) =>
        enabledHarnesses.map(async (harnessId) => {
          const preview = await controlPlane.dashboard.previewExperiment(
            actor,
            {
              name: benchmark.id,
              benchmarkId: benchmark.id,
              runnerId: selectedRunner.id,
              ...(harnessId === "llmbench" && selectedCredential
                ? { credentialProfileId: selectedCredential.id }
                : {}),
              ...dashboardMatrixForHarness(harnessId, selectedRunner.inventory),
            },
          );
          return [`${benchmark.id}:${harnessId}`, preview] as const;
        }),
      ),
    );
    Object.assign(previews, Object.fromEntries(entries));
  }
  const curationPreviews = actor.isAdmin
    ? Object.fromEntries(
        await Promise.all(
          experiments.map(
            async (experiment) =>
              [
                experiment.id,
                await controlPlane.publicResults.previewCuration(
                  actor,
                  experiment.id,
                ),
              ] as const,
          ),
        ),
      )
    : {};

  return (
    <DashboardShell
      cancelJobAction={cancelJobAction}
      advertisedMcpProfiles={selectedRunner?.inventory.mcpProfiles.map(
        ({ id, version, contentHash }) => ({ id, version, contentHash }),
      )}
      advertisedPlugins={selectedRunner?.inventory.plugins.map(
        ({ protocolVersion, contentHash, manifest }) => ({
          id: manifest.id,
          version: manifest.version,
          protocolVersion,
          contentHash,
          supportsMcp: manifest.capabilities.includes("mcp"),
        }),
      )}
      credentialProfiles={credentialProfiles}
      curateExperimentAction={curateExperimentAction}
      curationPreviews={curationPreviews}
      experiments={experiments}
      githubLogin={session.user.githubLogin}
      isAdmin={actor.isAdmin}
      launchExperimentAction={launchExperimentAction}
      name={session.user.name ?? session.user.githubLogin}
      previews={previews}
      retryJobAction={retryJobAction}
      runners={runners}
      saveCredentialProfileAction={saveCredentialProfileAction}
      selectedRunnerId={selectedRunner?.id ?? null}
      withdrawExperimentAction={withdrawExperimentAction}
    />
  );
}
