import type { ReactNode } from "react";
import Link from "next/link";

import type {
  CredentialProfile,
  DashboardExperimentDetail,
  DashboardRunner,
  PublicCurationPreview,
} from "@llm-bench/control-plane";
import { benchmarkCatalog } from "@llm-bench/control-plane";

import type {
  AdvertisedMcpProfile,
  AdvertisedPluginChoice,
  DashboardHarnessPreviews,
} from "./experiment-matrix";
import { CredentialForm } from "./credential-form";
import { DashboardPoller } from "./dashboard-poller";
import { ExperimentMatrix } from "./experiment-matrix";

type FormAction = (formData: FormData) => void | Promise<void>;
const activeJobStatuses = new Set([
  "queued",
  "leased",
  "preparing",
  "running",
  "grading",
  "uploading",
]);

export function DashboardShell({
  cancelJobAction,
  curateExperimentAction,
  advertisedMcpProfiles = [],
  advertisedPlugins = [],
  curationPreviews = {},
  credentialProfiles,
  githubLogin,
  isAdmin = false,
  launchExperimentAction,
  name,
  previews,
  retryJobAction,
  runners,
  saveCredentialProfileAction,
  selectedRunnerId,
  withdrawExperimentAction,
  experiments,
}: {
  readonly cancelJobAction?: FormAction;
  readonly curateExperimentAction?: FormAction;
  readonly advertisedMcpProfiles?: readonly AdvertisedMcpProfile[];
  readonly advertisedPlugins?: readonly AdvertisedPluginChoice[];
  readonly curationPreviews?: Readonly<
    Record<string, PublicCurationPreview | undefined>
  >;
  readonly credentialProfiles: readonly CredentialProfile[];
  readonly experiments: readonly DashboardExperimentDetail[];
  readonly githubLogin: string;
  readonly isAdmin?: boolean;
  readonly launchExperimentAction?: FormAction;
  readonly name: string;
  readonly previews: DashboardHarnessPreviews;
  readonly retryJobAction?: FormAction;
  readonly runners: readonly DashboardRunner[];
  readonly saveCredentialProfileAction?: FormAction;
  readonly selectedRunnerId?: string | null;
  readonly withdrawExperimentAction?: FormAction;
}) {
  const activePolling = experiments.some((experiment) =>
    experiment.jobs.some((job) => activeJobStatuses.has(job.status)),
  );
  const selectedRunner =
    runners.find(({ id }) => id === selectedRunnerId) ??
    runners.find(({ status }) => status === "online") ??
    runners[0] ??
    null;
  const selectedCredential =
    credentialProfiles.find(
      ({ runnerId }) => runnerId === selectedRunner?.id,
    ) ?? null;
  const initialHarnessId =
    selectedCredential &&
    (previews["repository-repair:llmbench"] ?? previews.llmbench)
      ? "llmbench"
      : (previews["repository-repair:codex"] ?? previews.codex)
        ? "codex"
        : (previews["repository-repair:claude"] ?? previews.claude)
          ? "claude"
          : (previews["repository-repair:pi"] ?? previews.pi)
            ? "pi"
            : "llmbench";

  return (
    <main className="bg-background text-foreground min-h-screen">
      <DashboardPoller active={activePolling} />
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-10 lg:px-12">
        <header className="border-border flex items-center justify-between border-b pb-6">
          <div className="flex items-center gap-4">
            <Link className="font-mono text-sm font-semibold" href="/">
              LLMBench
            </Link>
            <span className="bg-secondary text-secondary-foreground rounded-md px-3 py-1 font-mono text-[10px] tracking-wider uppercase">
              Private workspace
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground hidden sm:inline">
              @{githubLogin}
            </span>
            <Link
              className="hover:text-primary py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/api/auth/signout"
            >
              Sign out
            </Link>
          </div>
        </header>

        <section className="py-10">
          <p className="text-primary font-mono text-xs tracking-[0.2em] uppercase">
            Control plane
          </p>
          <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h1 className="text-4xl font-semibold sm:text-5xl">
                Good to see you, {name}.
              </h1>
              <p className="text-muted-foreground mt-4 max-w-2xl">
                Pair runners, select sealed credentials, launch matrix jobs, and
                inspect repository-repair results from this private workspace.
              </p>
            </div>
            <div className="bg-muted text-muted-foreground rounded-md px-5 py-3 font-mono text-xs tracking-wide uppercase">
              {activePolling ? "Jobs active" : "No active jobs"}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <WorkspacePanel title="Runners">
            {runners.length === 0 ? (
              <EmptyState text="No paired runner yet." />
            ) : (
              <ul className="space-y-3">
                {runners.map((runner) => (
                  <li
                    className="border-border rounded-lg border p-4"
                    key={runner.id}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">{runner.name}</p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {runner.environment.os}{" "}
                          {runner.environment.architecture}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusPill status={runner.status} />
                        {runner.id === selectedRunner?.id ? (
                          <span
                            aria-current="true"
                            className="text-primary text-xs font-medium"
                          >
                            Selected
                          </span>
                        ) : (
                          <Link
                            className="text-primary text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
                            href={`/dashboard?runnerId=${encodeURIComponent(runner.id)}`}
                          >
                            Use runner
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link
              className="border-border mt-5 inline-flex rounded-md border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/dashboard/runners/pair"
            >
              Pair runner
            </Link>
          </WorkspacePanel>

          <WorkspacePanel title="Credentials">
            {credentialProfiles.length === 0 ? (
              <EmptyState text="No credential profile yet." />
            ) : (
              <ul className="space-y-3">
                {credentialProfiles.map((profile) => (
                  <li
                    className="border-border rounded-lg border p-4"
                    key={profile.id}
                  >
                    <p className="font-medium">{profile.label}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {profile.provider} · {profile.maskedSecret}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {selectedRunner && saveCredentialProfileAction ? (
              <CredentialForm
                action={saveCredentialProfileAction}
                runner={{
                  id: selectedRunner.id,
                  publicKey: selectedRunner.publicKey,
                }}
              />
            ) : null}
          </WorkspacePanel>
        </section>

        <section className="border-border mt-8 border-t pt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <ExperimentMatrix
              action={launchExperimentAction}
              advertisedMcpProfiles={advertisedMcpProfiles}
              advertisedPlugins={advertisedPlugins}
              benchmarkCatalog={benchmarkCatalog}
              credentialProfileId={selectedCredential?.id}
              initialHarnessId={initialHarnessId}
              previews={previews}
              runnerId={selectedRunner?.id ?? null}
            />
          </div>
        </section>

        <section className="border-border mt-8 border-t pt-8">
          <h2 className="text-2xl font-semibold">Experiments</h2>
          {experiments.length === 0 ? (
            <div className="mt-5">
              <EmptyState text="No experiments launched." />
            </div>
          ) : (
            <div className="mt-5 grid gap-5">
              {experiments.map((experiment) => (
                <ExperimentCard
                  cancelJobAction={cancelJobAction}
                  curateExperimentAction={curateExperimentAction}
                  curationPreview={curationPreviews[experiment.id]}
                  experiment={experiment}
                  isAdmin={isAdmin}
                  key={experiment.id}
                  retryJobAction={retryJobAction}
                  withdrawExperimentAction={withdrawExperimentAction}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function WorkspacePanel({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="border-border bg-card rounded-lg border p-5 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ExperimentCard({
  cancelJobAction,
  curateExperimentAction,
  curationPreview,
  experiment,
  isAdmin,
  retryJobAction,
  withdrawExperimentAction,
}: {
  readonly cancelJobAction?: FormAction;
  readonly curateExperimentAction?: FormAction;
  readonly curationPreview?: PublicCurationPreview;
  readonly experiment: DashboardExperimentDetail;
  readonly isAdmin: boolean;
  readonly retryJobAction?: FormAction;
  readonly withdrawExperimentAction?: FormAction;
}) {
  const analysisReady =
    experiment.progress.totalJobs > 0 &&
    experiment.progress.completedJobs > 0 &&
    experiment.progress.queuedJobs === 0 &&
    experiment.progress.runningJobs === 0;
  const curationReady = analysisReady;
  return (
    <article className="border-border rounded-lg border p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h3 className="text-xl font-semibold">{experiment.name}</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {experiment.progress.completedJobs}/{experiment.progress.totalJobs}{" "}
            completed
          </p>
        </div>
        <progress
          aria-label={`${experiment.name} progress`}
          className="h-3 w-full md:w-56"
          max={experiment.progress.totalJobs || 1}
          value={experiment.progress.completedJobs}
        />
      </div>
      {analysisReady ? (
        <Link
          className="bg-foreground text-background mt-5 inline-flex rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
          href={`/dashboard/results/${experiment.id}`}
        >
          Open charts and evidence
        </Link>
      ) : null}
      {isAdmin ? (
        <section
          aria-label={`${experiment.name} public curation`}
          className="bg-muted mt-5 rounded-lg p-4"
        >
          <p className="font-mono text-[11px] tracking-[0.16em] uppercase">
            Public curation
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Private prompts and artifacts are withheld. Only explicit model,
            harness, toolset, metric, case, and privacy-safe environment fields
            enter the immutable public snapshot.
          </p>
          {experiment.visibility === "public" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                className="text-primary text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
                href={`/results/${experiment.id}`}
              >
                View public result
              </Link>
              <form action={withdrawExperimentAction}>
                <input
                  name="experimentId"
                  type="hidden"
                  value={experiment.id}
                />
                <label className="flex max-w-sm items-start gap-2 text-xs">
                  <input
                    className="mt-0.5"
                    name="withdrawalConfirmed"
                    required
                    type="checkbox"
                  />
                  <span>
                    Withdrawal is permanent. This immutable result cannot be
                    republished.
                  </span>
                </label>
                <button
                  className="border-border mt-3 rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
                  type="submit"
                >
                  Withdraw from public
                </button>
              </form>
            </div>
          ) : experiment.curatedAt !== null ? (
            <p className="text-muted-foreground mt-4 text-sm">
              Withdrawn results cannot be republished. The immutable snapshot
              remains retained for audit history.
            </p>
          ) : (
            <form action={curateExperimentAction} className="mt-4">
              <input name="experimentId" type="hidden" value={experiment.id} />
              {curationPreview?.view ? (
                <div className="border-border bg-background rounded-md border p-4">
                  <p className="font-semibold">Sanitized publication preview</p>
                  <CurationSnapshotPreview view={curationPreview.view} />
                  {curationPreview.fingerprint ? (
                    <input
                      name="curationFingerprint"
                      type="hidden"
                      value={curationPreview.fingerprint}
                    />
                  ) : null}
                  <label className="mt-4 flex items-start gap-3 text-sm">
                    <input
                      className="mt-1"
                      name="curationConfirmed"
                      required
                      type="checkbox"
                    />
                    <span>
                      I reviewed this sanitized preview and confirm it is safe
                      to publish as an immutable public snapshot.
                    </span>
                  </label>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Sanitized publication preview is unavailable.
                </p>
              )}
              {curationPreview && curationPreview.blockers.length > 0 ? (
                <ul className="text-destructive mt-3 list-disc space-y-1 pl-5 text-sm">
                  {curationPreview.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
              <button
                className="bg-primary text-primary-foreground mt-4 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!curationReady || !curationPreview?.canPublish}
                type="submit"
              >
                Publish curated result
              </button>
              {!curationReady ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Wait for terminal jobs and at least one completed result.
                </p>
              ) : null}
            </form>
          )}
        </section>
      ) : null}
      <div className="mt-5 grid gap-3">
        {experiment.jobs.map((job) => (
          <div className="border-border rounded-lg border p-4" key={job.id}>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="font-medium">
                  {job.target.modelRoute.id} · {job.target.harness.id}
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {job.status}
                  {job.retryOfJobId ? " · retry" : ""}
                </p>
                {job.benchmark ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {job.benchmark.id} · {job.benchmark.targetKind} target
                  </p>
                ) : null}
                {job.primaryMetric ? (
                  <p className="mt-2 text-sm">
                    {job.primaryMetric.label}:{" "}
                    <span className="font-semibold">
                      {job.primaryMetric.value ?? "unknown"}
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {activeJobStatuses.has(job.status) ? (
                  <form action={cancelJobAction}>
                    <input name="jobId" type="hidden" value={job.id} />
                    <button
                      className="border-border rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
                      type="submit"
                    >
                      Cancel
                    </button>
                  </form>
                ) : null}
                {["failed", "cancelled", "interrupted"].includes(job.status) ? (
                  <form action={retryJobAction}>
                    <input name="jobId" type="hidden" value={job.id} />
                    <button
                      className="border-border rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
                      type="submit"
                    >
                      Retry
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function CurationSnapshotPreview({
  view,
}: {
  readonly view: NonNullable<PublicCurationPreview["view"]>;
}) {
  return (
    <div className="mt-3 space-y-4 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <PreviewValue label="Schema version" value={view.schemaVersion} />
        <PreviewValue label="Public experiment ID" value={view.id} />
        <PreviewValue label="Public title" value={view.name} />
        <PreviewValue label="Created at" value={view.createdAt} />
        <PreviewValue label="Publication time" value={view.curatedAt} />
        <PreviewValue
          label="Results"
          value={view.comparisonGroups.reduce(
            (count, group) => count + group.series.length,
            0,
          )}
        />
      </dl>
      <PreviewList
        label="Languages"
        values={view.languageBreakdown.map(
          ({ language, resultCount }) => `${language}: ${resultCount}`,
        )}
      />
      <PreviewList label="Snapshot warnings" values={view.warnings} />
      {view.comparisonGroups.map((group) => (
        <details
          className="border-border rounded-md border p-3"
          key={group.key}
          open
        >
          <summary className="cursor-pointer font-semibold">
            Comparison group · {group.benchmark.id} {group.benchmark.version}
          </summary>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <PreviewValue label="Compatibility ID" value={group.key} />
            <PreviewValue label="Benchmark ID" value={group.benchmark.id} />
            <PreviewValue
              label="Benchmark version"
              value={group.benchmark.version}
            />
            <PreviewValue label="Case ID" value={group.benchmark.caseId} />
            <PreviewValue
              label="Language"
              value={group.benchmark.language ?? "Not specified"}
            />
            <PreviewValue
              label="Ranking eligible"
              value={group.comparison.rankingEligible ? "Yes" : "No"}
            />
            <PreviewValue
              label="Changed dimensions"
              value={listValue(group.comparison.changedDimensions)}
            />
            <PreviewValue
              label="Runner"
              value={`${group.environment.os} · ${group.environment.architecture} · ${group.environment.cpuClass} · ${group.environment.memoryMb} MB`}
            />
            <PreviewValue
              label="Runtime versions"
              value={recordValue(group.environment.runtimeVersions)}
            />
            <PreviewValue
              label="Harness versions"
              value={recordValue(group.environment.harnessVersions)}
            />
            <PreviewValue
              label="Sandbox mode"
              value={group.environment.sandboxMode}
            />
          </dl>
          <PreviewList label="Group warnings" values={group.warnings} />
          <div className="mt-3 space-y-3">
            {group.series.map((series) => (
              <details className="bg-muted rounded-md p-3" key={series.id} open>
                <summary className="cursor-pointer font-medium">
                  {series.label}
                </summary>
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  <PreviewValue label="Public label" value={series.label} />
                  <PreviewValue label="Result ID" value={series.id} />
                  <PreviewValue label="Job ID" value={series.jobId} />
                  <PreviewValue
                    label="Result created at"
                    value={series.createdAt}
                  />
                  <PreviewValue label="Status" value={series.status} />
                  <PreviewValue
                    label="Rank"
                    value={series.rank ?? "Not ranked"}
                  />
                  <PreviewValue
                    label="Sample count"
                    value={series.sampleCount}
                  />
                  <PreviewValue
                    label="Model"
                    value={`${series.target.model.provider} · ${series.target.model.id}`}
                  />
                  <PreviewValue
                    label="Harness"
                    value={`${series.target.harness.id} · ${series.target.harness.version}`}
                  />
                  <PreviewValue
                    label="Toolset"
                    value={`${series.target.toolset.id} · ${series.target.toolset.version}`}
                  />
                  <PreviewValue
                    label="Tools"
                    value={listValue(series.target.toolset.tools)}
                  />
                  <PreviewValue
                    label="MCP profiles"
                    value={listValue(
                      series.target.toolset.mcpProfiles.map(
                        ({ id, version }) => `${id} · ${version}`,
                      ),
                    )}
                  />
                  <PreviewValue
                    label="Primary metric"
                    value={metricValue(series.primaryMetric)}
                  />
                  <PreviewValue
                    label="Withheld artifact summary"
                    value={`${series.artifactSummary.withheldCount} artifacts · ${series.artifactSummary.totalBytes} bytes · ${listValue(series.artifactSummary.kinds)}`}
                  />
                </dl>
                <PreviewList
                  label="All metrics"
                  values={series.metrics.map(metricValue)}
                />
                <PreviewList
                  label="Measured samples"
                  values={series.samples.map(
                    (sample) =>
                      `#${sample.index}: ${listValue(
                        sample.observations.map(
                          ({ metricId, value }) => `${metricId}=${value}`,
                        ),
                      )}`,
                  )}
                />
              </details>
            ))}
          </div>
        </details>
      ))}
      <dl className="grid gap-2 sm:grid-cols-2">
        <PreviewValue
          label="Withheld artifacts"
          value={view.sanitization.withheldArtifactCount}
        />
        <PreviewValue
          label="Redacted fields"
          value={listValue(view.sanitization.redactedFields)}
        />
        <PreviewValue
          label="Always excluded"
          value={listValue(view.sanitization.excludedFields)}
        />
      </dl>
    </div>
  );
}

function PreviewValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number | string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function PreviewList({
  label,
  values,
}: {
  readonly label: string;
  readonly values: readonly string[];
}) {
  return (
    <div className="mt-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="break-words">{listValue(values)}</p>
    </div>
  );
}

function listValue(values: readonly string[]): string {
  return values.length === 0 ? "None" : values.join(", ");
}

function recordValue(values: Readonly<Record<string, string>>): string {
  return listValue(
    Object.entries(values).map(([name, version]) => `${name}=${version}`),
  );
}

function metricValue(
  metric: NonNullable<
    PublicCurationPreview["view"]
  >["comparisonGroups"][number]["series"][number]["primaryMetric"],
): string {
  return `${metric.label} (${metric.id}) · ${metric.kind} · ${metric.direction} · value=${metric.value ?? "null"} ${metric.unit} · ${
    metric.missing ? "missing" : "available"
  }`;
}

function EmptyState({ text }: { readonly text: string }) {
  return (
    <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
      {text}
    </p>
  );
}

function StatusPill({
  status,
}: {
  readonly status: DashboardRunner["status"];
}) {
  return (
    <span className="bg-muted rounded-md px-3 py-1 font-mono text-[11px] uppercase">
      {status}
    </span>
  );
}
