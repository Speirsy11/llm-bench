import type { ReactNode } from "react";
import Link from "next/link";

import type {
  CredentialProfile,
  DashboardExperimentDetail,
  DashboardRunner,
} from "@llm-bench/control-plane";

import type { DashboardHarnessPreviews } from "./experiment-matrix";
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
  credentialProfiles,
  githubLogin,
  launchExperimentAction,
  name,
  previews,
  retryJobAction,
  runners,
  saveCredentialProfileAction,
  selectedRunnerId,
  experiments,
}: {
  readonly cancelJobAction?: FormAction;
  readonly credentialProfiles: readonly CredentialProfile[];
  readonly experiments: readonly DashboardExperimentDetail[];
  readonly githubLogin: string;
  readonly launchExperimentAction?: FormAction;
  readonly name: string;
  readonly previews: DashboardHarnessPreviews;
  readonly retryJobAction?: FormAction;
  readonly runners: readonly DashboardRunner[];
  readonly saveCredentialProfileAction?: FormAction;
  readonly selectedRunnerId?: string | null;
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
    selectedCredential && previews.llmbench
      ? "llmbench"
      : previews.codex
        ? "codex"
        : previews.claude
          ? "claude"
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
                  experiment={experiment}
                  key={experiment.id}
                  retryJobAction={retryJobAction}
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
  experiment,
  retryJobAction,
}: {
  readonly cancelJobAction?: FormAction;
  readonly experiment: DashboardExperimentDetail;
  readonly retryJobAction?: FormAction;
}) {
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
