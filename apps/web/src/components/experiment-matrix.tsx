"use client";

import type { DashboardHarnessId } from "@/app/dashboard/matrix";
import { useState } from "react";

import type {
  Capability,
  HarnessManifest,
  ModelRoute,
  Toolset,
} from "@llm-bench/contracts";

export type DashboardHarnessPreviews = Partial<
  Record<DashboardHarnessId, DashboardExperimentPreview>
>;

interface DashboardExperimentPreview {
  readonly input: {
    readonly name: string;
    readonly runnerId: string;
    readonly benchmarkId?: string;
    readonly credentialProfileId?: string;
    readonly modelRoutes: readonly ModelRoute[];
    readonly harnesses: readonly HarnessManifest[];
    readonly toolsets: readonly Toolset[];
  };
  readonly projectedJobCount: number;
  readonly spend: { readonly kind: "unknown" };
  readonly canLaunch: boolean;
  readonly blockers: readonly string[];
  readonly order: readonly {
    readonly position: number;
    readonly modelRouteId: string;
    readonly harnessId: string;
    readonly toolsetId: string;
    readonly requiredCapabilities: readonly Capability[];
  }[];
}

export interface AdvertisedPluginChoice {
  readonly id: string;
  readonly version: string;
  readonly protocolVersion: string;
  readonly contentHash: string;
  readonly supportsMcp: boolean;
}

export interface AdvertisedMcpProfile {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

type FormAction = (formData: FormData) => void | Promise<void>;
interface BenchmarkChoice {
  readonly id: string;
  readonly targetKind: "response" | "workspace";
}

export function ExperimentMatrix({
  action,
  advertisedMcpProfiles = [],
  advertisedPlugins = [],
  benchmarkCatalog,
  credentialProfileId,
  initialHarnessId,
  previews,
  runnerId,
}: {
  readonly action?: FormAction;
  readonly advertisedMcpProfiles?: readonly AdvertisedMcpProfile[];
  readonly advertisedPlugins?: readonly AdvertisedPluginChoice[];
  readonly benchmarkCatalog: readonly [BenchmarkChoice, ...BenchmarkChoice[]];
  readonly credentialProfileId?: string;
  readonly initialHarnessId: DashboardHarnessId;
  readonly previews: DashboardHarnessPreviews;
  readonly runnerId: string | null;
}) {
  const [harnessId, setHarnessId] = useState(initialHarnessId);
  const [benchmarkId, setBenchmarkId] = useState("repository-repair");
  const preview =
    previews[`${benchmarkId}:${harnessId}`] ?? previews[harnessId] ?? null;
  const benchmark =
    benchmarkCatalog.find(({ id }) => id === benchmarkId) ??
    benchmarkCatalog[0];
  const canLaunch = Boolean(runnerId && preview?.canLaunch);

  return (
    <>
      <section className="border-border bg-card rounded-lg border p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Experiment Matrix</h2>
        <div className="mt-4">
          {runnerId && preview ? (
            <form action={action} className="grid gap-4">
              <input name="runnerId" type="hidden" value={runnerId} />
              {harnessId === "llmbench" && credentialProfileId ? (
                <input
                  name="credentialProfileId"
                  type="hidden"
                  value={credentialProfileId}
                />
              ) : null}
              <label className="grid gap-2 text-sm font-medium">
                Name
                <input
                  className="border-input bg-background rounded-md border px-3 py-2"
                  name="name"
                  required
                  defaultValue="Benchmark comparison"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Benchmark
                <select
                  className="border-input bg-background rounded-md border px-3 py-2"
                  name="benchmarkId"
                  value={benchmarkId}
                  onChange={(event) => setBenchmarkId(event.target.value)}
                >
                  {benchmarkCatalog.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.id} · {choice.targetKind}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="grid gap-3">
                <legend className="text-sm font-medium">Harness</legend>
                {previews[`${benchmarkId}:llmbench`] || previews.llmbench ? (
                  <HarnessChoice
                    disabled={!credentialProfileId}
                    harnessId="llmbench"
                    label="LLMBench"
                    selectedHarnessId={harnessId}
                    select={setHarnessId}
                  />
                ) : null}
                {previews[`${benchmarkId}:codex`] || previews.codex ? (
                  <HarnessChoice
                    disabled={false}
                    harnessId="codex"
                    label="Codex"
                    selectedHarnessId={harnessId}
                    select={setHarnessId}
                  />
                ) : null}
                {previews[`${benchmarkId}:claude`] || previews.claude ? (
                  <HarnessChoice
                    disabled={false}
                    harnessId="claude"
                    label="Claude"
                    selectedHarnessId={harnessId}
                    select={setHarnessId}
                  />
                ) : null}
                {previews[`${benchmarkId}:pi`] || previews.pi ? (
                  <HarnessChoice
                    disabled={false}
                    harnessId="pi"
                    label="Pi"
                    selectedHarnessId={harnessId}
                    select={setHarnessId}
                  />
                ) : null}
                {advertisedPlugins.map((plugin) =>
                  previews[`${benchmarkId}:${plugin.id}`] ||
                  previews[plugin.id] ? (
                    <HarnessChoice
                      disabled={false}
                      harnessId={plugin.id}
                      key={plugin.id}
                      label={`${plugin.id} · v${plugin.version} · protocol ${plugin.protocolVersion} · ${plugin.contentHash}`}
                      selectedHarnessId={harnessId}
                      select={setHarnessId}
                    />
                  ) : null,
                )}
              </fieldset>
              {advertisedPlugins.find(({ id }) => id === harnessId)
                ?.supportsMcp ? (
                <fieldset className="grid gap-3">
                  <legend className="text-sm font-medium">
                    Runner-installed MCP profiles
                  </legend>
                  {advertisedMcpProfiles.map((profile) => (
                    <label
                      className="flex items-center gap-3 text-sm"
                      key={profile.id}
                    >
                      <input
                        name="mcpProfile"
                        type="checkbox"
                        value={profile.id}
                      />
                      {profile.id} · v{profile.version} · {profile.contentHash}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {harnessId === "llmbench" ? (
                <fieldset className="grid gap-3">
                  <legend className="text-sm font-medium">
                    LLMBench model routes
                  </legend>
                  {preview.input.modelRoutes.map((route) => (
                    <label
                      className="flex items-center gap-3 text-sm"
                      key={route.id}
                    >
                      <input
                        name="modelRoute"
                        type="checkbox"
                        value={route.id}
                        defaultChecked
                      />
                      {route.provider === "openrouter"
                        ? "OpenRouter"
                        : route.provider}
                      {" · "}
                      {route.model}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Codex, Claude, and Pi use their selected native model and local
                authentication. Hosted credentials are sent only to LLMBench.
              </p>
              <label className="flex items-center gap-3 text-sm">
                <input name="spendConfirmed" required type="checkbox" />
                Confirm unknown spend
              </label>
              <button
                className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
                disabled={!canLaunch}
                type="submit"
              >
                Launch experiment
              </button>
              {!canLaunch ? (
                <EmptyState text="Resolve matrix blockers before launching." />
              ) : null}
            </form>
          ) : runnerId ? (
            <EmptyState text="No compatible matrix preview yet." />
          ) : (
            <EmptyState text="Pair a runner before launching." />
          )}
        </div>
      </section>

      <section className="border-border bg-card rounded-lg border p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Preview</h2>
        <div className="mt-4">
          {preview ? (
            <div className="space-y-4">
              <div>
                <p className="text-3xl font-semibold">
                  {preview.projectedJobCount}
                </p>
                <p className="text-muted-foreground text-sm">
                  projected {preview.projectedJobCount === 1 ? "job" : "jobs"}
                  {` · ${benchmark.targetKind} target · spend unknown`}
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
        </div>
      </section>
    </>
  );
}

function HarnessChoice({
  disabled,
  harnessId,
  label,
  selectedHarnessId,
  select,
}: {
  readonly disabled: boolean;
  readonly harnessId: string;
  readonly label: string;
  readonly selectedHarnessId: string;
  readonly select: (harnessId: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input
        checked={selectedHarnessId === harnessId}
        disabled={disabled}
        name="harness"
        onChange={() => select(harnessId)}
        type="radio"
        value={harnessId}
      />
      {label}
    </label>
  );
}

function EmptyState({ text }: { readonly text: string }) {
  return (
    <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
      {text}
    </p>
  );
}
