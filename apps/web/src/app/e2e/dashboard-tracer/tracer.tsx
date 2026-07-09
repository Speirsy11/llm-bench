"use client";

import { useMemo, useState } from "react";

type JobStatus = "queued" | "completed" | "cancelled";

interface Job {
  readonly id: string;
  readonly route: string;
  readonly status: JobStatus;
  readonly retryOfJobId: string | null;
  readonly metric: number | null;
}

export function FixtureDashboardTracer() {
  const [credentialSaved, setCredentialSaved] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const activeJobs = jobs.filter((job) => job.status === "queued").length;
  const preview = useMemo(
    () => [
      "openrouter-gpt-4o · llmbench · builtin",
      "openrouter-llama · llmbench · builtin",
    ],
    [],
  );

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="border-border flex items-center justify-between border-b pb-6">
          <div>
            <p className="font-mono text-sm font-semibold">LLMBench</p>
            <h1 className="mt-4 text-4xl font-semibold">
              Dashboard experiment tracer
            </h1>
          </div>
          <span className="bg-muted rounded-md px-4 py-2 text-sm">
            {activeJobs > 0 ? "Jobs active" : "No active jobs"}
          </span>
        </header>

        <section className="grid gap-5 py-8 lg:grid-cols-2">
          <section className="border-border rounded-lg border p-5">
            <h2 className="text-xl font-semibold">Runner</h2>
            <div className="mt-4 rounded-lg border p-4">
              <p className="font-medium">Fixture runner</p>
              <p className="text-muted-foreground mt-1 text-sm">
                online · linux arm64
              </p>
            </div>
          </section>

          <section className="border-border rounded-lg border p-5">
            <h2 className="text-xl font-semibold">Credential</h2>
            {credentialSaved ? (
              <p className="mt-4 rounded-lg border p-4">
                OpenRouter fixture · sk-or-v1...test
              </p>
            ) : (
              <form
                className="mt-4 grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  setCredentialSaved(true);
                }}
              >
                <label className="grid gap-2 text-sm font-medium">
                  Masked secret
                  <input
                    className="border-input rounded-md border px-3 py-2"
                    defaultValue="sk-or-v1...test"
                    name="maskedSecret"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  Sealed ciphertext
                  <textarea
                    className="border-input min-h-20 rounded-md border px-3 py-2"
                    defaultValue="sealed-fixture-ciphertext"
                    name="ciphertext"
                    required
                  />
                </label>
                <button
                  className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold"
                  type="submit"
                >
                  Save credential
                </button>
              </form>
            )}
          </section>
        </section>

        <section className="border-border grid gap-5 border-t py-8 lg:grid-cols-[1fr_20rem]">
          <section className="border-border rounded-lg border p-5">
            <h2 className="text-xl font-semibold">Experiment Matrix</h2>
            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setJobs([
                  {
                    id: "job-1",
                    route: "openrouter-gpt-4o",
                    status: "queued",
                    retryOfJobId: null,
                    metric: null,
                  },
                  {
                    id: "job-2",
                    route: "openrouter-llama",
                    status: "queued",
                    retryOfJobId: null,
                    metric: null,
                  },
                ]);
              }}
            >
              <label className="grid gap-2 text-sm font-medium">
                Name
                <input
                  className="border-input rounded-md border px-3 py-2"
                  defaultValue="Repository repair"
                  name="name"
                  required
                />
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input required name="spendConfirmed" type="checkbox" />
                Confirm unknown spend
              </label>
              <button
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={!credentialSaved}
                type="submit"
              >
                Launch experiment
              </button>
            </form>
          </section>
          <section className="border-border rounded-lg border p-5">
            <h2 className="text-xl font-semibold">Preview</h2>
            <p className="text-muted-foreground mt-3 text-sm">
              2 projected jobs · spend unknown
            </p>
            <ol className="mt-4 space-y-2">
              {preview.map((target, index) => (
                <li
                  className="rounded-lg border px-3 py-2 text-sm"
                  key={target}
                >
                  {index + 1}. {target}
                </li>
              ))}
            </ol>
          </section>
        </section>

        <section className="border-border border-t py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Repository repair</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {completedJobs}/{jobs.length} completed
              </p>
            </div>
            <button
              className="border-border rounded-md border px-4 py-2 text-sm font-medium"
              disabled={jobs.every((job) => job.status !== "queued")}
              onClick={() => {
                setJobs((current) =>
                  current.map((job) =>
                    job.status === "queued"
                      ? {
                          ...job,
                          status: "completed",
                          metric: 1,
                        }
                      : job,
                  ),
                );
              }}
              type="button"
            >
              Run fixture runner
            </button>
          </div>
          {jobs.length === 0 ? (
            <p className="text-muted-foreground mt-5 rounded-lg border border-dashed p-4 text-sm">
              No experiments launched.
            </p>
          ) : (
            <div className="mt-5 grid gap-3">
              {jobs.map((job) => (
                <div className="rounded-lg border p-4" key={job.id}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">{job.route} · llmbench</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {job.status}
                        {job.retryOfJobId ? " · retry" : ""}
                      </p>
                      {job.metric === null ? null : (
                        <p className="mt-2 text-sm">
                          Hidden test pass ratio:{" "}
                          <span className="font-semibold">{job.metric}</span>
                        </p>
                      )}
                    </div>
                    {job.status === "queued" ? (
                      <button
                        className="rounded-md border px-3 py-2 text-sm font-medium"
                        onClick={() =>
                          setJobs((current) =>
                            current.map((item) =>
                              item.id === job.id
                                ? { ...item, status: "cancelled" }
                                : item,
                            ),
                          )
                        }
                        type="button"
                      >
                        Cancel
                      </button>
                    ) : null}
                    {job.status === "cancelled" ? (
                      <button
                        className="rounded-md border px-3 py-2 text-sm font-medium"
                        onClick={() =>
                          setJobs((current) => [
                            ...current,
                            {
                              id: `${job.id}-retry`,
                              route: job.route,
                              status: "queued",
                              retryOfJobId: job.id,
                              metric: null,
                            },
                          ])
                        }
                        type="button"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
