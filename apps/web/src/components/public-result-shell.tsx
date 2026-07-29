import type { ReactNode } from "react";
import Link from "next/link";

import type {
  PublicComparisonGroup,
  PublicExperimentView,
  PublicMetricValue,
  PublicResultSeries,
} from "@llm-bench/control-plane";

type ResultContext = "private" | "public";

export function PublicResultShell({
  context = "public",
  result,
}: {
  readonly context?: ResultContext;
  readonly result: PublicExperimentView;
}) {
  const allSeries = result.comparisonGroups.flatMap(({ series }) => series);
  const benchmarkCount = new Set(
    result.comparisonGroups.map(({ benchmark }) => benchmark.id),
  ).size;
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        <ResultHeader context={context} />

        <section className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)] lg:items-end">
          <div>
            <p className="text-primary font-mono text-xs tracking-[0.22em] uppercase">
              {context === "private"
                ? "Your experiment evidence"
                : "Curated public evidence"}
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
              {result.name}
            </h1>
            <p className="text-muted-foreground mt-6 max-w-3xl text-lg leading-8">
              Every chart below keeps benchmark version, case, harness, toolset,
              sample count, and runner conditions attached. Groups are split
              before comparison whenever those experimental conditions differ.
            </p>
          </div>
          <dl className="border-border bg-card grid grid-cols-3 gap-px overflow-hidden rounded-2xl border shadow-sm">
            <HeroMetric label="Results" value={String(allSeries.length)} />
            <HeroMetric
              label="Groups"
              value={String(result.comparisonGroups.length)}
            />
            <HeroMetric label="Benchmarks" value={String(benchmarkCount)} />
          </dl>
        </section>

        <section
          aria-labelledby="methodology-heading"
          className="border-border bg-card rounded-3xl border p-6 shadow-sm sm:p-8"
        >
          <div className="grid gap-7 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
                Methodology first
              </p>
              <h2
                className="mt-3 text-2xl font-semibold"
                id="methodology-heading"
              >
                How to read this result
              </h2>
            </div>
            <div className="text-muted-foreground grid gap-4 text-sm leading-6 sm:grid-cols-3">
              <MethodNote
                index="01"
                text="Compare ranks only inside one compatible group."
              />
              <MethodNote
                index="02"
                text="Use sample counts and missing markers before drawing conclusions."
              />
              <MethodNote
                index="03"
                text="Open the exact table and conditions behind every chart."
              />
            </div>
          </div>
        </section>

        {result.warnings.length > 0 ? (
          <aside
            aria-label="Comparison warning"
            className="border-primary/30 bg-primary/5 mt-8 rounded-2xl border p-5"
          >
            <p className="font-semibold">Separate comparison groups</p>
            <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </aside>
        ) : null}

        <div className="mt-10 space-y-10">
          {result.comparisonGroups.map((group, index) => (
            <ComparisonGroup
              context={context}
              group={group}
              index={index}
              key={group.key}
            />
          ))}
        </div>

        <section className="border-border mt-10 grid gap-6 border-t pt-10 lg:grid-cols-2">
          <Trajectory context={context} groups={result.comparisonGroups} />
          <LanguageBreakdown rows={result.languageBreakdown} />
        </section>

        <SanitizationSummary context={context} result={result} />
      </div>
    </main>
  );
}

function ResultHeader({ context }: { readonly context: ResultContext }) {
  const isPrivate = context === "private";
  return (
    <header className="border-border flex flex-wrap items-center justify-between gap-4 border-b pb-6">
      <div className="flex items-center gap-4">
        <Link className="font-mono text-sm font-semibold" href="/">
          LLMBench
        </Link>
        <span className="bg-secondary text-secondary-foreground rounded-full px-3 py-1 font-mono text-[10px] tracking-wider uppercase">
          {isPrivate ? "Private analysis" : "Public results"}
        </span>
      </div>
      <nav
        aria-label={
          isPrivate ? "Private analysis navigation" : "Public result navigation"
        }
        className="flex gap-4 text-sm"
      >
        {isPrivate ? (
          <Link
            className="bg-foreground text-background rounded-full px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
        ) : (
          <>
            <Link
              className="hover:text-primary py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/results"
            >
              All results
            </Link>
            <Link
              className="bg-foreground text-background rounded-full px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/api/auth/signin"
            >
              Open workspace
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4 text-center">
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-2 font-mono text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function MethodNote({ index, text }: { index: string; text: string }) {
  return (
    <div>
      <p className="text-primary font-mono text-xs">{index}</p>
      <p className="mt-2">{text}</p>
    </div>
  );
}

function ComparisonGroup({
  context,
  group,
  index,
}: {
  readonly context: ResultContext;
  readonly group: PublicComparisonGroup;
  readonly index: number;
}) {
  const groupNumber = index + 1;
  const changed = group.comparison.changedDimensions;
  const displayGroup = {
    ...group,
    series: seriesInDisplayOrder(group),
  };
  return (
    <article
      aria-labelledby={`comparison-group-${groupNumber}`}
      className="border-border bg-card overflow-hidden rounded-3xl border shadow-sm"
    >
      <div className="border-border border-b p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <p className="text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
              Comparable group {groupNumber}
            </p>
            <h2
              className="mt-3 text-2xl font-semibold"
              id={`comparison-group-${groupNumber}`}
            >
              {humanize(group.benchmark.id)}{" "}
              <span className="text-muted-foreground font-normal">
                v{group.benchmark.version}
              </span>
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Case {group.benchmark.caseId}
              {group.benchmark.language
                ? ` · ${humanize(group.benchmark.language)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConditionPill>
              {group.environment.os}/{group.environment.architecture}
            </ConditionPill>
            <ConditionPill>{group.environment.sandboxMode}</ConditionPill>
            <ConditionPill>
              {displayGroup.series.length} target
              {displayGroup.series.length === 1 ? "" : "s"}
            </ConditionPill>
          </div>
        </div>
        <p className="mt-5 text-sm font-medium">
          {changed.length === 0
            ? "No target variable changes inside this group."
            : `${changed.length === 1 ? "Changed variable" : "Changed variables"}: ${changed.join(", ")}`}
        </p>
        {group.warnings.length > 0 ? (
          <ul className="text-muted-foreground mt-3 space-y-1 text-sm">
            {group.warnings.map((warning) => (
              <li key={warning}>— {warning}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="bg-border grid gap-px lg:grid-cols-2">
        <ChartPanel
          description="Aggregate primary metric values in rank order. Ranking appears only when every target has enough comparable measured samples."
          title={`${displayGroup.series[0]?.primaryMetric.label ?? "Primary metric"} aggregate ranking`}
        >
          <PrimaryMetricRankingChart group={displayGroup} index={groupNumber} />
        </ChartPanel>
        <ChartPanel
          description="One mark per measured response repetition. Warm-ups and aggregate ranks are excluded; agentic runs do not claim a repetition distribution."
          title={`${displayGroup.series[0]?.primaryMetric.label ?? "Primary metric"} measured samples`}
        >
          <PrimaryMetricChart group={displayGroup} index={groupNumber} />
          <SampleEvidenceTable series={displayGroup.series} />
        </ChartPanel>
        <ChartPanel
          description="Primary quality against observed harness duration; unavailable values stay absent."
          title="Quality vs time"
        >
          <QualityTimeChart group={displayGroup} index={groupNumber} />
        </ChartPanel>
        <ChartPanel
          description="Primary quality against reported provider cost; unavailable values stay explicitly absent."
          title="Quality vs cost"
        >
          <QualityCostChart group={displayGroup} index={groupNumber} />
        </ChartPanel>
      </div>

      <div className="border-border border-t p-6 sm:p-8">
        <ExactValuesTable group={displayGroup} />
      </div>

      <div className="border-border grid gap-4 border-t p-6 sm:p-8 lg:grid-cols-3">
        <ConditionDetails group={displayGroup} />
        <TargetDetails series={displayGroup.series} />
        <DiffEvidence context={context} series={displayGroup.series} />
      </div>
    </article>
  );
}

function seriesInDisplayOrder(
  group: PublicComparisonGroup,
): readonly PublicResultSeries[] {
  if (!group.comparison.rankingEligible) return group.series;
  return group.series
    .map((series, sourceIndex) => ({ series, sourceIndex }))
    .sort(
      (left, right) =>
        (left.series.rank ?? Number.POSITIVE_INFINITY) -
          (right.series.rank ?? Number.POSITIVE_INFINITY) ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ series }) => series);
}

function ConditionPill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-3 py-1.5 font-mono text-[11px]">
      {children}
    </span>
  );
}

function ChartPanel({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <section className="bg-card min-w-0 p-6 sm:p-8">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-2 text-sm">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function PrimaryMetricChart({
  group,
  index,
}: {
  readonly group: PublicComparisonGroup;
  readonly index: number;
}) {
  const available = group.series.flatMap((series) => {
    const values = series.samples.flatMap(({ observations }) => {
      const observation = observations.find(
        ({ metricId }) => metricId === series.primaryMetric.id,
      );
      return observation ? [observation.value] : [];
    });
    return values.length > 0 ? [{ series, values }] : [];
  });
  if (available.length === 0) {
    return (
      <ChartEmpty text="No repetition-level response evidence is available for this group." />
    );
  }
  const values = available.flatMap(({ values: sampleValues }) => sampleValues);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const range = Math.max(maxValue - minValue, Number.EPSILON);
  const height = Math.max(150, available.length * 58 + 34);
  const metric = available[0]?.series.primaryMetric;
  const titleId = `distribution-chart-title-${index}`;
  const descriptionId = `distribution-chart-description-${index}`;
  return (
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="h-auto w-full"
      role="img"
      viewBox={`0 0 360 ${height}`}
    >
      <title id={titleId}>
        {`${metric?.label ?? "Primary metric"} measured response samples`}
      </title>
      <desc id={descriptionId}>
        {values.length} measured repetitions across {available.length} targets;{" "}
        {metric?.direction === "lower_is_better"
          ? "lower values rank better"
          : "higher values rank better"}
        . Warm-up samples are excluded.
      </desc>
      {available.map(({ series, values: sampleValues }, seriesIndex) => {
        const y = seriesIndex * 58 + 18;
        return (
          <g key={series.id}>
            <title>
              {`${modelLabel(series.target)}: ${sampleValues.length} measured samples`}
            </title>
            <text className="fill-foreground text-[13px]" x="0" y={y + 15}>
              {truncate(modelLabel(series.target), 13)}
            </text>
            <line
              className="stroke-border"
              strokeWidth="2"
              x="145"
              x2="270"
              y1={y + 11}
              y2={y + 11}
            />
            {sampleValues.map((value, sampleIndex) => (
              <circle
                className="fill-chart-1 stroke-card"
                cx={145 + ((value - minValue) / range) * 125}
                cy={y + 11}
                key={`${series.id}-${sampleIndex}`}
                r="6"
                strokeWidth="2"
              />
            ))}
            <text
              className="fill-foreground font-mono text-[12px]"
              textAnchor="end"
              x="355"
              y={y + 15}
            >
              n={sampleValues.length}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PrimaryMetricRankingChart({
  group,
  index,
}: {
  readonly group: PublicComparisonGroup;
  readonly index: number;
}) {
  const available = group.series.filter(
    (
      series,
    ): series is PublicResultSeries & {
      primaryMetric: PublicMetricValue & { value: number };
      rank: number;
    } => series.primaryMetric.value !== null && series.rank !== null,
  );
  if (!group.comparison.rankingEligible || available.length < 2) {
    return (
      <ChartEmpty text="Aggregate ranking is unavailable for this comparison group." />
    );
  }
  const values = available.map(({ primaryMetric }) => primaryMetric.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const range = Math.max(maxValue - minValue, Number.EPSILON);
  const metric = available[0]?.primaryMetric;
  const height = Math.max(150, available.length * 58 + 34);
  const titleId = `ranking-chart-title-${index}`;
  const descriptionId = `ranking-chart-description-${index}`;
  return (
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="h-auto w-full"
      role="img"
      viewBox={`0 0 360 ${height}`}
    >
      <title id={titleId}>
        {`${metric?.label ?? "Primary metric"} aggregate ranking`}
      </title>
      <desc id={descriptionId}>
        Ranked aggregate {metric?.label.toLowerCase() ?? "primary metric"} for{" "}
        {available.length} compatible targets;{" "}
        {metric?.direction === "lower_is_better"
          ? "lower values rank better"
          : "higher values rank better"}
        . Exact values and measured sample counts follow in the table.
      </desc>
      {available.map((series, seriesIndex) => {
        const y = seriesIndex * 58 + 18;
        const width =
          18 + ((series.primaryMetric.value - minValue) / range) * (125 - 18);
        return (
          <g key={series.id}>
            <title>
              {`${modelLabel(series.target)}: rank ${series.rank}; ${formatMetric(series.primaryMetric, series.primaryMetric.value)}; n=${series.sampleCount}`}
            </title>
            <text className="fill-foreground text-[13px]" x="0" y={y + 15}>
              {truncate(modelLabel(series.target), 13)}
            </text>
            <rect
              className="fill-chart-1"
              height="18"
              rx="5"
              width={width}
              x="145"
              y={y + 2}
            />
            <text
              className="fill-foreground font-mono text-[12px]"
              textAnchor="end"
              x="355"
              y={y + 15}
            >
              #{series.rank} ·{" "}
              {formatMetric(series.primaryMetric, series.primaryMetric.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SampleEvidenceTable({
  series,
}: {
  readonly series: readonly PublicResultSeries[];
}) {
  const rows = series.flatMap((item) =>
    item.samples.map((sample) => ({ item, sample })),
  );
  if (rows.length === 0) return null;
  return (
    <div
      aria-label="Scrollable measured samples table"
      className="border-border mt-6 overflow-x-auto border-t pt-5"
      role="region"
      tabIndex={0}
    >
      <table
        aria-label="Ordered measured response samples"
        className="w-full min-w-[24rem] text-left text-xs"
      >
        <thead>
          <tr>
            <TableHeading>Target</TableHeading>
            <TableHeading>Repetition</TableHeading>
            <TableHeading>Measured observations</TableHeading>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map(({ item, sample }) => (
            <tr key={`${item.id}-${sample.index}`}>
              <TableCell>{modelLabel(item.target)}</TableCell>
              <TableCell>{sample.index + 1}</TableCell>
              <TableCell>
                {sample.observations
                  .map(
                    ({ metricId, value }) =>
                      `${metricLabel(item, metricId)}: ${formatNumber(value)}`,
                  )
                  .join(" · ")}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function metricLabel(series: PublicResultSeries, metricId: string): string {
  return (
    series.metrics.find(({ id }) => id === metricId)?.label ??
    humanize(metricId)
  );
}

function QualityTimeChart({
  group,
  index,
}: {
  readonly group: PublicComparisonGroup;
  readonly index: number;
}) {
  return (
    <QualityTradeoffChart
      group={group}
      index={index}
      metricId="duration_ms"
      title="Quality versus time"
      unavailableText="Quality-versus-time needs a higher-is-better primary metric and harness duration values."
      xLabel="Harness duration"
    />
  );
}

function QualityCostChart({
  group,
  index,
}: {
  readonly group: PublicComparisonGroup;
  readonly index: number;
}) {
  return (
    <QualityTradeoffChart
      group={group}
      index={index}
      metricId="cost_usd"
      title="Quality versus cost"
      unavailableText="Quality-versus-cost needs a higher-is-better primary metric and reported provider cost."
      xLabel="Provider cost"
    />
  );
}

function QualityTradeoffChart({
  group,
  index,
  metricId,
  title,
  unavailableText,
  xLabel,
}: {
  readonly group: PublicComparisonGroup;
  readonly index: number;
  readonly metricId: "cost_usd" | "duration_ms";
  readonly title: string;
  readonly unavailableText: string;
  readonly xLabel: string;
}) {
  const primaryDefinition = group.series[0]?.primaryMetric;
  if (
    primaryDefinition?.direction !== "higher_is_better" ||
    primaryDefinition.id === metricId
  ) {
    return <ChartEmpty text={unavailableText} />;
  }
  const points = group.series.flatMap((series) => {
    const xMetric = series.metrics.find(({ id }) => id === metricId);
    return series.primaryMetric.value === null || xMetric?.value == null
      ? []
      : [
          {
            id: series.id,
            label: modelLabel(series.target),
            quality: series.primaryMetric.value,
            xValue: xMetric.value,
            xMetric,
          },
        ];
  });
  if (points.length === 0) {
    return <ChartEmpty text={unavailableText} />;
  }
  const referenceXMetric = points[0]?.xMetric;
  if (!referenceXMetric) {
    return <ChartEmpty text={unavailableText} />;
  }
  const maxQuality = Math.max(...points.map(({ quality }) => quality), 1);
  const maxX = Math.max(...points.map(({ xValue }) => xValue), Number.EPSILON);
  const titleId = `${metricId}-scatter-title-${index}`;
  const descriptionId = `${metricId}-scatter-description-${index}`;
  return (
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="h-auto w-full"
      role="img"
      viewBox="0 0 360 250"
    >
      <title id={titleId}>{title}</title>
      <desc id={descriptionId}>
        Scatter plot of {primaryDefinition.label}, where higher is better,
        against {xLabel.toLowerCase()} for {points.length} targets. Exact
        plotted values follow in the table.
      </desc>
      <line
        className="stroke-border"
        strokeWidth="2"
        x1="48"
        x2="340"
        y1="210"
        y2="210"
      />
      <line
        className="stroke-border"
        strokeWidth="2"
        x1="48"
        x2="48"
        y1="22"
        y2="210"
      />
      <text className="fill-muted-foreground text-[11px]" x="48" y="238">
        {metricId === "duration_ms" ? "0ms" : "$0"}
      </text>
      <text
        className="fill-muted-foreground text-[11px]"
        textAnchor="end"
        x="340"
        y="238"
      >
        {formatMetric(referenceXMetric, maxX)}
      </text>
      <text
        className="fill-muted-foreground text-[11px]"
        textAnchor="end"
        x="42"
        y="30"
      >
        {formatMetric(primaryDefinition, maxQuality)}
      </text>
      <text
        className="fill-muted-foreground text-[11px]"
        textAnchor="end"
        x="42"
        y="214"
      >
        0
      </text>
      {points.map((point, pointIndex) => {
        const x = 48 + (point.xValue / maxX) * 278;
        const y = 210 - (point.quality / maxQuality) * 170;
        return (
          <g key={point.id}>
            <title>
              {`${point.label}: ${formatMetric(primaryDefinition, point.quality)}; ${formatMetric(point.xMetric)}`}
            </title>
            <circle
              className={pointIndex % 2 === 0 ? "fill-chart-1" : "fill-chart-2"}
              cx={x}
              cy={y}
              r="8"
            />
            <text
              className="fill-foreground text-[11px]"
              textAnchor={x > 270 ? "end" : "start"}
              x={x > 270 ? x - 12 : x + 12}
              y={y + 4}
            >
              {truncate(point.label, 14)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ChartEmpty({ text }: { readonly text: string }) {
  return (
    <p className="border-border text-muted-foreground rounded-xl border border-dashed p-5 text-sm">
      {text}
    </p>
  );
}

function ExactValuesTable({
  group,
}: {
  readonly group: PublicComparisonGroup;
}) {
  const secondaryMetrics = uniqueMetrics(group.series).filter(
    ({ id }) => id !== group.series[0]?.primaryMetric.id,
  );
  return (
    <section aria-labelledby={`exact-values-${group.key}`}>
      <h3 className="text-lg font-semibold" id={`exact-values-${group.key}`}>
        Exact values
      </h3>
      <div className="mt-4 space-y-3 sm:hidden">
        {group.series.map((series) => (
          <dl
            className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm"
            key={series.id}
          >
            <Detail label="Rank">{series.rank ?? "Not ranked"}</Detail>
            <Detail label="Model">{modelLabel(series.target)}</Detail>
            <Detail label="Harness">
              {harnessLabel(series.target.harness.id)}{" "}
              {series.target.harness.version}
            </Detail>
            <Detail label="Toolset">
              {series.target.toolset.id} {series.target.toolset.version}
            </Detail>
            <Detail label={series.primaryMetric.label}>
              {series.primaryMetric.missing
                ? "Missing"
                : formatMetric(series.primaryMetric)}
            </Detail>
            {secondaryMetrics.map((metric) => {
              const value = series.metrics.find(({ id }) => id === metric.id);
              return (
                <Detail key={metric.id} label={metric.label}>
                  {value ? formatMetric(value) : "Not reported"}
                </Detail>
              );
            })}
            <Detail label="Samples">n={series.sampleCount}</Detail>
            <Detail label="Status">{humanize(series.status)}</Detail>
          </dl>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 hidden text-xs sm:block">
        Scroll horizontally to inspect every reported metric.
      </p>
      <div
        aria-label="Scrollable exact values table"
        className="border-border mt-3 hidden overflow-x-auto rounded-xl border sm:block"
        role="region"
        tabIndex={0}
      >
        <table
          aria-label="Exact values"
          className="w-full min-w-[64rem] border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-border border-b">
              <TableHeading>Rank</TableHeading>
              <TableHeading>Model</TableHeading>
              <TableHeading>Harness</TableHeading>
              <TableHeading>Toolset</TableHeading>
              <TableHeading>
                {group.series[0]?.primaryMetric.label ?? "Primary metric"}
              </TableHeading>
              {secondaryMetrics.map((metric) => (
                <TableHeading key={metric.id}>{metric.label}</TableHeading>
              ))}
              <TableHeading>Samples</TableHeading>
              <TableHeading>Status</TableHeading>
            </tr>
          </thead>
          <tbody>
            {group.series.map((series) => (
              <tr
                className="border-border border-b last:border-0"
                key={series.id}
              >
                <TableCell>{series.rank ?? "Not ranked"}</TableCell>
                <TableCell>{modelLabel(series.target)}</TableCell>
                <TableCell>
                  {harnessLabel(series.target.harness.id)}{" "}
                  {series.target.harness.version}
                </TableCell>
                <TableCell>
                  {series.target.toolset.id} {series.target.toolset.version}
                </TableCell>
                <TableCell>
                  {series.primaryMetric.missing
                    ? "Missing"
                    : formatMetric(series.primaryMetric)}
                </TableCell>
                {secondaryMetrics.map((metric) => {
                  const value = series.metrics.find(
                    ({ id }) => id === metric.id,
                  );
                  return (
                    <TableCell key={metric.id}>
                      {value ? formatMetric(value) : "Not reported"}
                    </TableCell>
                  );
                })}
                <TableCell>n={series.sampleCount}</TableCell>
                <TableCell>{humanize(series.status)}</TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TableHeading({ children }: { readonly children: ReactNode }) {
  return (
    <th className="text-muted-foreground px-3 py-3 font-medium" scope="col">
      {children}
    </th>
  );
}

function TableCell({ children }: { readonly children: ReactNode }) {
  return <td className="px-3 py-4 align-top">{children}</td>;
}

function ConditionDetails({
  group,
}: {
  readonly group: PublicComparisonGroup;
}) {
  const environment = group.environment;
  return (
    <details className="border-border rounded-xl border p-4" open>
      <summary className="cursor-pointer font-semibold">
        Case and conditions
      </summary>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
        <Detail label="Case">{group.benchmark.caseId}</Detail>
        <Detail label="Benchmark">
          {group.benchmark.id} {group.benchmark.version}
        </Detail>
        <Detail label="Environment">
          {environment.cpuClass} · {environment.memoryMb.toLocaleString()} MB
        </Detail>
        <Detail label="Runtime">
          {recordLabel(environment.runtimeVersions)}
        </Detail>
        <Detail label="Harness versions">
          {recordLabel(environment.harnessVersions)}
        </Detail>
        <Detail label="Sandbox">{environment.sandboxMode}</Detail>
        <Detail label="Compatibility fingerprint">{group.key}</Detail>
      </dl>
    </details>
  );
}

function TargetDetails({
  series,
}: {
  readonly series: readonly PublicResultSeries[];
}) {
  return (
    <details className="border-border rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Harness and toolset drill-down
      </summary>
      <div className="mt-4 space-y-4">
        {series.map((item) => (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"
            key={item.id}
          >
            <Detail label="Model">{modelLabel(item.target)}</Detail>
            <Detail label="Harness">
              {harnessLabel(item.target.harness.id)}{" "}
              {item.target.harness.version}
            </Detail>
            <Detail label="Toolset">
              {item.target.toolset.id} {item.target.toolset.version}
            </Detail>
            <Detail label="Tools">
              {item.target.toolset.tools.length > 0
                ? item.target.toolset.tools.join(", ")
                : "None"}
            </Detail>
            <Detail label="MCP profiles">
              {item.target.toolset.mcpProfiles.length > 0
                ? item.target.toolset.mcpProfiles
                    .map(({ id, version }) => `${id} ${version}`)
                    .join(", ")
                : "None"}
            </Detail>
          </dl>
        ))}
      </div>
    </details>
  );
}

function DiffEvidence({
  context,
  series,
}: {
  readonly context: ResultContext;
  readonly series: readonly PublicResultSeries[];
}) {
  return (
    <details className="border-border rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Diff evidence summary
      </summary>
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        {context === "private"
          ? "This analysis view includes only artifact type, count, and byte size. Raw contents, paths, and hashes remain withheld."
          : "Only artifact type, count, and byte size are public. Raw contents, paths, and hashes remain withheld."}
      </p>
      <div className="mt-4 space-y-4">
        {series.map((item) => (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"
            key={item.id}
          >
            <Detail label="Model">{modelLabel(item.target)}</Detail>
            <Detail label="Artifacts">
              {item.artifactSummary.withheldCount === 0
                ? "No artifact evidence reported"
                : `${item.artifactSummary.withheldCount} withheld · ${formatBytes(item.artifactSummary.totalBytes)}`}
            </Detail>
            <Detail label="Types">
              {item.artifactSummary.kinds.length > 0
                ? item.artifactSummary.kinds.join(", ")
                : "None"}
            </Detail>
          </dl>
        ))}
      </div>
    </details>
  );
}

function Detail({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Trajectory({
  context,
  groups,
}: {
  readonly context: ResultContext;
  readonly groups: readonly PublicComparisonGroup[];
}) {
  const tracks = groupTrajectories(groups);
  return (
    <section
      aria-labelledby="trajectory-heading"
      className="border-border bg-card rounded-2xl border p-6"
    >
      <h2 className="text-xl font-semibold" id="trajectory-heading">
        Trajectories and chronological results
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Aggregate results are tracked through time by exact target
        configuration. Each n value is the underlying measured sample count.
      </p>
      {tracks.length === 0 ? (
        <ChartEmpty
          text={
            context === "private"
              ? "No analysis results are available."
              : "No public results are available."
          }
        />
      ) : (
        <div className="mt-5 space-y-6">
          {tracks.map(({ key, items }) => (
            <div key={key}>
              <p className="font-medium">
                {items[0] ? modelLabel(items[0].target) : ""}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {items.length === 1
                  ? "One aggregate result; no trajectory yet."
                  : `${items.length} chronological aggregate results`}
              </p>
              <ol className="border-border mt-3 space-y-0 border-l">
                {items.map((item, itemIndex) => {
                  const previous = items[itemIndex - 1];
                  return (
                    <li className="relative pb-4 pl-5 last:pb-0" key={item.id}>
                      <span className="bg-primary absolute top-1.5 -left-1.5 h-3 w-3 rounded-full" />
                      <p className="text-sm">
                        {item.primaryMetric.label}:{" "}
                        <strong>{formatMetric(item.primaryMetric)}</strong>{" "}
                        <span className="text-muted-foreground">
                          · n={item.sampleCount}
                        </span>
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatDate(item.createdAt)}
                        {previous
                          ? ` · ${metricDelta(previous.primaryMetric, item.primaryMetric)}`
                          : ""}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LanguageBreakdown({
  rows,
}: {
  readonly rows: PublicExperimentView["languageBreakdown"];
}) {
  return (
    <section
      aria-labelledby="language-heading"
      className="border-border bg-card rounded-2xl border p-6"
    >
      <h2 className="text-xl font-semibold" id="language-heading">
        Language breakdown
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Agentic cases remain segmented by implementation language.
      </p>
      {rows.length === 0 ? (
        <div className="mt-5">
          <ChartEmpty text="This response benchmark has no language dimension." />
        </div>
      ) : (
        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          {rows.map(({ language, resultCount }) => (
            <div className="bg-muted rounded-xl p-4" key={language}>
              <dt className="font-medium">{languageLabel(language)}</dt>
              <dd className="text-muted-foreground mt-1 text-sm">
                {resultCount} result{resultCount === 1 ? "" : "s"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function SanitizationSummary({
  context,
  result,
}: {
  readonly context: ResultContext;
  readonly result: PublicExperimentView;
}) {
  const { sanitization } = result;
  return (
    <section
      aria-labelledby="sanitization-heading"
      className="border-border mt-10 border-t py-10"
    >
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start">
        <div>
          <p className="text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
            {context === "private"
              ? "Private display boundary"
              : "Publication boundary"}
          </p>
          <h2 className="mt-3 text-xl font-semibold" id="sanitization-heading">
            {context === "private"
              ? "Sanitized analysis view"
              : "Sanitized for public inspection"}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
            {context === "private"
              ? "This private chart view uses the same allowlisted projection as publication. Credentials, prompts, user identity, runner names, absolute paths, artifact contents, locations, and hashes are never included."
              : "Public pages are rendered from an immutable allowlisted snapshot. Credentials, prompts, user identity, runner names, absolute paths, artifact contents, locations, and hashes are never included."}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-muted rounded-xl p-4">
            <dt className="text-muted-foreground">Artifacts</dt>
            <dd className="mt-1 font-semibold">
              {sanitization.withheldArtifactCount} private artifact
              {sanitization.withheldArtifactCount === 1 ? "" : "s"} withheld
            </dd>
          </div>
          <div className="bg-muted rounded-xl p-4">
            <dt className="text-muted-foreground">Redactions</dt>
            <dd className="mt-1 font-semibold">
              {sanitization.redactedFields.length} field
              {sanitization.redactedFields.length === 1 ? "" : "s"} redacted
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function formatMetric(metric: PublicMetricValue, value = metric.value): string {
  if (value === null) return "Missing";
  if (metric.kind === "ratio") return `${(value * 100).toFixed(0)}%`;
  if (metric.kind === "currency") return `$${value.toFixed(4)}`;
  if (metric.unit === "ms") {
    return value >= 1000
      ? `${(value / 1000).toFixed(2)}s`
      : `${value.toFixed(0)}ms`;
  }
  return `${value.toLocaleString()} ${metric.unit}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function uniqueMetrics(
  series: readonly PublicResultSeries[],
): PublicMetricValue[] {
  const metrics = new Map<string, PublicMetricValue>();
  for (const item of series) {
    for (const metric of item.metrics) metrics.set(metric.id, metric);
  }
  return [...metrics.values()];
}

function groupTrajectories(
  groups: readonly PublicComparisonGroup[],
): { key: string; items: PublicResultSeries[] }[] {
  const tracks = new Map<string, PublicResultSeries[]>();
  for (const group of groups) {
    for (const item of group.series) {
      const key = JSON.stringify({
        comparisonGroup: group.key,
        model: item.target.model,
        harness: item.target.harness,
        toolset: item.target.toolset,
      });
      const current = tracks.get(key) ?? [];
      current.push(item);
      tracks.set(key, current);
    }
  }
  return [...tracks.entries()].map(([key, items]) => ({
    key,
    items: [...items].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
  }));
}

function metricDelta(
  previous: PublicMetricValue,
  current: PublicMetricValue,
): string {
  if (
    previous.id !== current.id ||
    previous.value === null ||
    current.value === null
  ) {
    return "change unavailable";
  }
  const difference = current.value - previous.value;
  const improved =
    difference === 0
      ? "unchanged"
      : difference > 0 === (current.direction === "higher_is_better")
        ? "improved"
        : "regressed";
  return `${formatMetricDelta(current, difference)} · ${improved}`;
}

function formatMetricDelta(
  metric: PublicMetricValue,
  difference: number,
): string {
  const sign = difference > 0 ? "+" : difference < 0 ? "-" : "";
  const magnitude = Math.abs(difference);
  if (metric.kind === "ratio") {
    return `${sign}${(magnitude * 100).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}%`;
  }
  if (metric.kind === "currency") {
    return `${sign}$${magnitude.toFixed(4)}`;
  }
  return `${sign}${formatMetric(metric, magnitude)}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function recordLabel(record: Readonly<Record<string, string>>): string {
  const entries = Object.entries(record);
  return entries.length === 0
    ? "Not reported"
    : entries.map(([key, value]) => `${key} ${value}`).join(", ");
}

function humanize(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function languageLabel(language: string): string {
  return language.toLowerCase() === "typescript"
    ? "TypeScript"
    : humanize(language);
}

function harnessLabel(harness: string): string {
  return harness.toLowerCase() === "llmbench" ? "LLMBench" : humanize(harness);
}

function modelLabel(target: PublicResultSeries["target"]): string {
  return `${target.model.provider}/${target.model.id}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
