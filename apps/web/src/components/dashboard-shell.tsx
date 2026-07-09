import type { ReactNode } from "react";
import Link from "next/link";

import type {
  CredentialProfile,
  DashboardExperimentDetail,
  ExperimentPreview,
  PairedRunner,
} from "@llm-bench/control-plane";

import { DashboardPoller } from "./dashboard-poller";

type FormAction = (formData: FormData) => void | Promise<void>;

export function DashboardShell({
  cancelJobAction,
  credentialProfiles,
  githubLogin,
  launchExperimentAction,
  name,
  preview,
  retryJobAction,
  runners,
  saveCredentialProfileAction,
  experiments,
}: {
  readonly cancelJobAction?: FormAction;
  readonly credentialProfiles: readonly CredentialProfile[];
  readonly experiments: readonly DashboardExperimentDetail[];
  readonly githubLogin: string;
  readonly launchExperimentAction?: FormAction;
  readonly name: string;
  readonly preview: ExperimentPreview | null;
  readonly retryJobAction?: FormAction;
  readonly runners: readonly PairedRunner[];
  readonly saveCredentialProfileAction?: FormAction;
}) {
  const activePolling = experiments.some((experiment) =>
    experiment.jobs.some((job) =>
      [
        "queued",
        "leased",
        "preparing",
        "running",
        "grading",
        "uploading",
      ].includes(job.status),
    ),
  );
  const primaryRunner = runners[0] ?? null;
  const primaryCredential = credentialProfiles[0] ?? null;

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
                      <StatusPill status={runner.status} />
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
            {primaryRunner ? (
              <form
                action={saveCredentialProfileAction}
                className="border-border mt-5 grid gap-3 border-t pt-5"
              >
                <input name="runnerId" type="hidden" value={primaryRunner.id} />
                <label className="grid gap-2 text-sm font-medium">
                  Label
                  <input
                    className="border-input bg-background rounded-md border px-3 py-2"
                    name="label"
                    required
                    defaultValue="OpenRouter"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Provider
                  <select
                    className="border-input bg-background rounded-md border px-3 py-2"
                    name="provider"
                    defaultValue="openrouter"
                  >
                    <option value="openrouter">OpenRouter</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Masked secret
                  <input
                    className="border-input bg-background rounded-md border px-3 py-2"
                    name="maskedSecret"
                    required
                    placeholder="sk-or-v1...abcd"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Key fingerprint
                  <input
                    className="border-input bg-background rounded-md border px-3 py-2"
                    name="keyFingerprint"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Sealed ciphertext
                  <textarea
                    className="border-input bg-background min-h-24 rounded-md border px-3 py-2"
                    name="ciphertext"
                    required
                  />
                </label>
                <button
                  className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
                  type="submit"
                >
                  Save credential
                </button>
              </form>
            ) : null}
          </WorkspacePanel>
        </section>

        <section className="border-border mt-8 border-t pt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <WorkspacePanel title="Experiment Matrix">
              {primaryRunner && primaryCredential ? (
                <form action={launchExperimentAction} className="grid gap-4">
                  <input
                    name="runnerId"
                    type="hidden"
                    value={primaryRunner.id}
                  />
                  <input
                    name="credentialProfileId"
                    type="hidden"
                    value={primaryCredential.id}
                  />
                  <label className="grid gap-2 text-sm font-medium">
                    Name
                    <input
                      className="border-input bg-background rounded-md border px-3 py-2"
                      name="name"
                      required
                      defaultValue="Repository repair"
                    />
                  </label>
                  <fieldset className="grid gap-3">
                    <legend className="text-sm font-medium">
                      Model routes
                    </legend>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        name="modelRoute"
                        type="checkbox"
                        value="openrouter-gpt-4o"
                        defaultChecked
                      />
                      OpenRouter · GPT-4o
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        name="modelRoute"
                        type="checkbox"
                        value="openrouter-llama"
                        defaultChecked
                      />
                      OpenRouter · Llama 3.1
                    </label>
                  </fieldset>
                  <label className="flex items-center gap-3 text-sm">
                    <input name="spendConfirmed" required type="checkbox" />
                    Confirm unknown spend
                  </label>
                  <button
                    className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
                    type="submit"
                  >
                    Launch experiment
                  </button>
                </form>
              ) : (
                <EmptyState text="Pair a runner and save a credential first." />
              )}
            </WorkspacePanel>

            <WorkspacePanel title="Preview">
              {preview ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-3xl font-semibold">
                      {preview.projectedJobCount}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      projected jobs · spend unknown
                    </p>
                  </div>
                  {preview.blockers.length > 0 ? (
                    <ul className="space-y-2" role="alert">
                      {preview.blockers.map((blocker) => (
                        <li className="text-destructive text-sm" key={blocker}>
                          {blocker}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <ol className="space-y-2">
                    {preview.order.map((target) => (
                      <li
                        className="border-border rounded-lg border px-3 py-2 text-sm"
                        key={target.position}
                      >
                        {target.position + 1}. {target.modelRouteId} ·{" "}
                        {target.harnessId} · {target.toolsetId}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <EmptyState text="No matrix preview yet." />
              )}
            </WorkspacePanel>
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
                {[
                  "queued",
                  "leased",
                  "preparing",
                  "running",
                  "grading",
                  "uploading",
                ].includes(job.status) ? (
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

function StatusPill({ status }: { readonly status: PairedRunner["status"] }) {
  return (
    <span className="bg-muted rounded-md px-3 py-1 font-mono text-[11px] uppercase">
      {status}
    </span>
  );
}
