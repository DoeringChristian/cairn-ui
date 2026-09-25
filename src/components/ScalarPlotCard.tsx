import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSequences, useSequencesForRuns } from "../api/hooks";
import { qk } from "../api/query-keys";
import type { CardSettingsKey, SetOptions } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { useCardDrop } from "../lib/use-series-drop";
import { useCardSeries, useRunInfo } from "./card-kit";
import {
  instanceDefaults as scalarInstanceDefaults,
  type ScalarGroupBy as GroupBy,
  type ScalarSettings,
} from "./cards-settings/scalar";
import type { RunDetailResponse, SequenceMeta, SequenceResponse } from "../api/types";
import SeriesChipStrip from "./SeriesChipStrip";
import AddToComparisonButton from "./AddToComparisonButton";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import { HeaderBadge, HeaderToggle } from "./card-header";
import ScalarSettingsPanel, { type ScalarPanelCtx } from "./settings-panels/ScalarSettingsPanel";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import ScalarChart, { type LineStyle, type ScalarView } from "../charts/ScalarChart";
import {
  compileSeriesExpr,
  compileTemplate,
  derivedLine,
  exprMetrics,
  limitRuns,
  makeRunContext,
  metricLine,
  metricRef,
  renderLabel,
  sequenceData,
  xAxisKind,
  type LineResult,
} from "../charts/scalar-data";
import { xMetricFor } from "../lib/metric-defs";
import { SERIES_COLORS, type Series } from "../lib/plot-utils/types";
import { SMOOTHING_KINDS, formatSmoothing } from "../lib/plot-utils/smooth";
import { groupSeries } from "../lib/plot-utils/aggregate";
import { RUN_PALETTE } from "../lib/run-color";
import { useRunColors, useRunView, useVisibleRuns } from "../lib/run-view";
import { cursorSyncKey, useChartSyncEnabled, useSyncedView } from "../lib/chart-sync";
import type { RunContext, SeriesData } from "../lib/expr";
import type { Run } from "../api/types";

const SCALAR_POLICY = plotCardPolicy("scalar");

/**
 * A card seeded for a metric tracked with `run.track(..., x=...)` starts on
 * that x-axis. Read from the query cache: the run page loads the run detail
 * before any card mounts.
 */
function seededX(qc: QueryClient, runId: string, seed: { name: string }): Pick<ScalarSettings, "x"> | null {
  const defs = qc.getQueryData<RunDetailResponse>(qk.run(runId))?.metric_defs;
  const name = xMetricFor(seed.name, defs);
  return name ? { x: metricRef(name) } : null;
}

/** A run's value for the grouping; null leaves the run ungrouped. */
function groupValue(
  by: GroupBy,
  run: Run | undefined,
  params: Record<string, unknown> | undefined,
): string | null {
  if (by.source === "group") return run?.group ?? null;
  if (by.source === "job_type") return run?.job_type ?? null;
  const v = params?.[by.key];
  if (v === undefined || v === null || !by.key) return null;
  return `${by.key}=${typeof v === "string" ? v : JSON.stringify(v)}`;
}

function viewportIsAuto(v: ScalarSettings["viewport"]): boolean {
  return v.xMin === null && v.xMax === null && v.yMin === null && v.yMax === null;
}

/** A derived series' line key: `expr:<i>`, per run when the card shows several. */
const derivedKey = (i: number, runId: string, multipleRuns: boolean) =>
  multipleRuns ? `expr:${i}::${runId}` : `expr:${i}`;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  onRemove?: () => void;
  settingsKeyOverride?: CardSettingsKey;
  autoOpenSettings?: boolean;
}

export default function ScalarPlotCard({
  runId,
  metric,
  extraSeries = [],
  controlledSeries = false,
  onRemove,
  settingsKeyOverride,
  autoOpenSettings,
}: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { ctl, effectiveMetrics, allRunIds, multipleRuns } = useCardSeries<ScalarSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    type: "scalar",
    instanceDefaults: (seed) => ({
      ...scalarInstanceDefaults(seed),
      ...seededX(qc, runId, seed),
    }),
  });
  const settings = ctl.value;
  const setSettings = ctl.set;

  const updateSettings = useCallback(
    (patch: Partial<ScalarSettings>, opts?: SetOptions) => {
      if (patch.metrics) {
        patch = {
          ...patch,
          metrics: [...patch.metrics].sort((a, b) => seriesKey(a).localeCompare(seriesKey(b))),
        };
      }
      setSettings(patch, opts);
    },
    [setSettings],
  );

  // -------------------------------------------------------------------------
  // Runs: hidden / pinned (run view), latest per group, the cap; colours
  // -------------------------------------------------------------------------
  const { runCreatedAtByRunId, runById, paramsByRunId, summaryByRunId } = useRunInfo(allRunIds);
  const paramKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of paramsByRunId.values()) for (const k of Object.keys(p)) keys.add(k);
    return [...keys].sort();
  }, [paramsByRunId]);

  const visibleRuns = useVisibleRuns(allRunIds);
  const drawnRuns = useMemo(() => {
    const by = settings.groupBy;
    return limitRuns(visibleRuns, {
      latestPerGroup: settings.latestPerGroup,
      maxRuns: settings.maxRuns,
      groupOf: (id) =>
        by ? groupValue(by, runById.get(id), paramsByRunId.get(id)) : (runById.get(id)?.group ?? null),
      createdAt: (id) => runCreatedAtByRunId.get(id),
    });
  }, [visibleRuns, settings.latestPerGroup, settings.maxRuns, settings.groupBy, runById, paramsByRunId, runCreatedAtByRunId]);
  const drawnSet = useMemo(() => new Set(drawnRuns), [drawnRuns]);
  const drawnMetrics = useMemo(
    () => effectiveMetrics.filter((m) => drawnSet.has(m.runId ?? runId)),
    [effectiveMetrics, drawnSet, runId],
  );
  const runColors = useRunColors(drawnRuns);
  const { view: runView } = useRunView();

  // -------------------------------------------------------------------------
  // Expressions: x, derived series, templates
  // -------------------------------------------------------------------------
  const xSrc = settings.x || "step";
  const xCompiled = useMemo(() => compileSeriesExpr(xSrc), [xSrc]);
  const derivedCompiled = useMemo(() => settings.derived.map((d) => compileSeriesExpr(d.src)), [settings.derived]);
  const legendTpl = useMemo(() => compileTemplate(settings.legend.template).value, [settings.legend.template]);
  const tooltipTpl = useMemo(() => compileTemplate(settings.tooltip.template).value, [settings.tooltip.template]);

  // -------------------------------------------------------------------------
  // Data fetch: each run's metrics, plus whatever x and derived series read
  // -------------------------------------------------------------------------
  const sequenceSpecs = useMemo(() => {
    const extra = [
      ...exprMetrics(xCompiled.value),
      ...derivedCompiled.flatMap((c) => exprMetrics(c.value)),
    ];
    const seen = new Set<string>();
    const specs: Array<{ runId: string; name: string }> = [];
    const add = (rid: string, name: string) => {
      const k = `${rid}\u0000${name}`;
      if (seen.has(k)) return;
      seen.add(k);
      specs.push({ runId: rid, name });
    };
    for (const m of drawnMetrics) add(m.runId ?? runId, m.name);
    for (const rid of drawnRuns) for (const name of extra) add(rid, name);
    return specs;
  }, [drawnMetrics, drawnRuns, xCompiled, derivedCompiled, runId]);
  const queries = useSequencesForRuns(sequenceSpecs);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const isLoading = queries.some((q) => q.isLoading);

  /** One expression context per drawn run. */
  const contexts = useMemo(() => {
    const seriesByRun = new Map<string, Map<string, SeriesData>>();
    sequenceSpecs.forEach((spec, i) => {
      const data = queries[i]?.data as SequenceResponse | undefined;
      if (!data) return;
      let m = seriesByRun.get(spec.runId);
      if (!m) seriesByRun.set(spec.runId, (m = new Map()));
      m.set(spec.name, sequenceData(data.points));
    });
    const out = new Map<string, RunContext>();
    for (const rid of drawnRuns) {
      out.set(
        rid,
        makeRunContext({
          series: seriesByRun.get(rid) ?? new Map(),
          run: runById.get(rid),
          config: paramsByRunId.get(rid),
          summary: summaryByRunId.get(rid),
        }),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceSpecs, dataKey, drawnRuns, runById, paramsByRunId, summaryByRunId]);

  // -------------------------------------------------------------------------
  // Build series
  // -------------------------------------------------------------------------
  const runMetaVersion = useRunMetadataVersion();

  const built = useMemo(() => {
    const xNode = xCompiled.value;
    let lines: Series[] = [];
    const styles: Record<string, LineStyle> = {};
    const tooltipLabels = new Map<string, string>();
    let asOf = false;
    const note = (r: LineResult) => {
      if (r.warnings.some((w) => w.kind === "asof-join")) asOf = true;
      return r.points;
    };
    const runLabel = (rid: string, ctx: RunContext | undefined) =>
      renderLabel(legendTpl, ctx, shortRunLabel(rid, drawnRuns));
    if (!xNode) return { lines, styles, tooltipLabels, asOf, groups: 0 };

    const metricNames = new Set(drawnMetrics.map((m) => m.name));
    drawnMetrics.forEach((m, idx) => {
      const rid = m.runId ?? runId;
      const ctx = contexts.get(rid)!;
      const key = seriesKey(m);
      const auto = multipleRuns ? runColors.get(rid)! : SERIES_COLORS[idx % SERIES_COLORS.length]!;
      const label = multipleRuns
        ? `${metricNames.size > 1 ? `${m.name} · ` : ""}${runLabel(rid, ctx)}`
        : renderLabel(legendTpl, ctx, seriesLabel(m.name, rid, false, allRunIds));
      lines.push({ key, label, color: auto, points: note(metricLine(m.name, xNode, ctx)), runId: rid });
      if (tooltipTpl) tooltipLabels.set(key, renderLabel(tooltipTpl, ctx, label));
    });

    settings.derived.forEach((d, i) => {
      const node = derivedCompiled[i]?.value;
      if (!node) return;
      const name = d.label || d.src;
      drawnRuns.forEach((rid) => {
        const ctx = contexts.get(rid)!;
        const key = derivedKey(i, rid, multipleRuns);
        const label = multipleRuns ? `${name} · ${runLabel(rid, ctx)}` : name;
        const auto = multipleRuns
          ? runColors.get(rid)!
          : SERIES_COLORS[(drawnMetrics.length + i) % SERIES_COLORS.length]!;
        lines.push({
          key,
          label,
          color: d.style?.color ?? auto,
          points: note(derivedLine(node, xNode, ctx)),
          runId: rid,
        });
        if (d.style) styles[key] = d.style;
        if (tooltipTpl) tooltipLabels.set(key, `${name} · ${renderLabel(tooltipTpl, ctx, label)}`);
      });
    });

    // Grouping needs several runs; a run without a value for it stays its own line.
    let groups = 0;
    const by = settings.groupBy;
    if (by && multipleRuns) {
      const metricOf = (s: Series): { key: string; name: string } => {
        if (s.key.startsWith("expr:")) {
          const i = Number(s.key.slice(5, s.key.indexOf("::")));
          const d = settings.derived[i]!;
          return { key: `expr:${i}`, name: d.label || d.src };
        }
        const name = s.key.slice(s.key.indexOf("::") + 2);
        return { key: name, name };
      };
      const metricKeys = new Set<string>();
      const items = lines.map((s) => {
        const mk = metricOf(s);
        metricKeys.add(mk.key);
        return {
          series: s,
          metricKey: mk.key,
          metricName: mk.name,
          group: groupValue(by, runById.get(s.runId!), paramsByRunId.get(s.runId!)),
        };
      });
      // Groups take palette slots in sorted order (distinct, stable for a set of groups).
      const groupValues = [...new Set(items.map((i) => i.group).filter((g): g is string => g != null))].sort();
      const grouped = groupSeries(items, {
        band: settings.band,
        hideMembers: settings.hideMembers,
        labelMetric: metricKeys.size > 1,
        agg: settings.agg,
        groupColor: (g) => RUN_PALETTE[groupValues.indexOf(g) % RUN_PALETTE.length]!,
      });
      if (grouped.groups > 0) {
        lines = grouped.series;
        groups = grouped.groups;
      }
    }

    // Per-series styles (metric and group lines): colour for the line and its
    // band, width and dash for the line.
    lines = lines.map((s) => {
      const own = settings.styles[s.key];
      if (!own || s.role === "member") return s;
      if ((s.role ?? "line") === "line") styles[s.key] = own;
      return own.color ? { ...s, color: own.color } : s;
    });
    return { lines, styles, tooltipLabels, asOf, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    xCompiled,
    derivedCompiled,
    contexts,
    drawnMetrics,
    drawnRuns,
    runColors,
    legendTpl,
    tooltipTpl,
    settings.styles,
    settings.derived,
    settings.groupBy,
    settings.band,
    settings.agg,
    settings.hideMembers,
    multipleRuns,
    runId,
    allRunIds,
    runById,
    paramsByRunId,
    runMetaVersion,
  ]);
  const series = built.lines;
  const groups = built.groups;

  // -------------------------------------------------------------------------
  // Zoom: the card's own viewport, or the view another synced card zoomed to
  // -------------------------------------------------------------------------
  const cardId = useId();
  const syncGroup = xSrc.trim();
  const synced = useSyncedView(syncGroup, cardId);
  const syncOn = useChartSyncEnabled();
  const view: ScalarView = synced.view ?? settings.viewport;
  const onViewChange = (v: ScalarView) => {
    updateSettings({ viewport: v }, { mergeKey: "viewport", label: "Zoom" });
    synced.publish(v);
  };

  const viewportModified =
    !viewportIsAuto(view) ||
    settings.xRange[0] != null ||
    settings.xRange[1] != null ||
    settings.yRange[0] != null ||
    settings.yRange[1] != null;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    (): ComparisonSeriesRef[] => effectiveMetrics.map((m) => ({ runId: m.runId ?? runId, name: m.name })),
    [runId, effectiveMetrics],
  );

  const flipYScale = () => updateSettings({ yScale: settings.yScale === "log" ? "linear" : "log" });

  const resetViewport = () => {
    updateSettings({
      viewport: { xMin: null, xMax: null, yMin: null, yMax: null },
      xRange: [null, null],
      yRange: [null, null],
    });
    synced.publish({ xMin: null, xMax: null, yMin: null, yMax: null });
  };

  const totalPoints = useMemo(() => {
    let n = 0;
    for (const s of series) if ((s.role ?? "line") === "line") n += s.points.length;
    return n;
  }, [series]);

  const subtitle = `${groups > 0 ? `${groups} group${groups === 1 ? "" : "s"}` : `${series.length} series`}${
    totalPoints > 0 ? ` · ${totalPoints} pts` : ""
  }${drawnRuns.length < allRunIds.length ? ` · ${drawnRuns.length}/${allRunIds.length} runs` : ""}`;

  // -------------------------------------------------------------------------
  // Settings panel
  // -------------------------------------------------------------------------
  const runSequences = useSequences(runId);
  const chosen = useMemo(() => [...new Set(effectiveMetrics.map((m) => m.name))], [effectiveMetrics]);
  const metricNames = useMemo(() => {
    const names = new Set<string>(chosen);
    for (const m of runSequences.data?.sequences ?? []) if (m.object_type === "scalar") names.add(m.name);
    return [...names].sort();
  }, [runSequences.data, chosen]);
  // Every run draws each chosen metric: removing a name drops it for all
  // runs, adding one adds it for all of them.
  const onChosenChange = (names: string[]) => {
    const keep = new Set(names);
    const kept = effectiveMetrics.filter((m) => keep.has(m.name));
    const have = new Set(kept.map((m) => m.name));
    const perRun = controlledSeries || multipleRuns;
    const fresh = names
      .filter((n) => !have.has(n))
      .flatMap((name) => (perRun ? allRunIds.map((rid) => ({ runId: rid, name })) : [{ name }]));
    updateSettings({ metrics: [...kept, ...fresh] });
  };
  const panelCtx: ScalarPanelCtx = {
    metricNames,
    chosen,
    onChosenChange,
    paramKeys,
    multipleRuns,
    lines: series
      .filter((s) => (s.role ?? "line") === "line" && !s.key.startsWith("expr:"))
      .map((s) => ({ key: s.key, label: s.label, color: s.color })),
  };
  const settingsPanel = <ScalarSettingsPanel ctl={ctl} ctx={panelCtx} mode="card" />;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);
  const hasData = series.some((s) => s.points.length > 0);

  const onOpenRun = (rid: string) => {
    const pid = runById.get(rid)?.project_id;
    if (pid) navigate(`/p/${pid}/r/${rid}`);
  };

  const plotProps = {
    series,
    xKind: xAxisKind(xSrc),
    xLabel: xSrc,
    xScale: settings.xScale,
    yScale: settings.yScale,
    xRange: settings.xRange,
    yRange: settings.yRange,
    view,
    onViewChange,
    smoothing: settings.smoothing,
    smoothingKind: settings.smoothingKind,
    outlierPct: settings.outlierPct,
    lineType: settings.lineType,
    showOriginal: settings.showOriginal,
    stack: settings.stack,
    fullFidelity: settings.fullFidelity,
    legend: settings.legend,
    tooltip: settings.tooltip,
    tooltipLabels: built.tooltipLabels.size > 0 ? built.tooltipLabels : undefined,
    axisTitles: settings.axisTitles,
    styles: built.styles,
    baselineRunId: runView.baseline,
    cursorSyncKey: syncOn ? cursorSyncKey(syncGroup) : null,
    onOpenRun,
  };

  const xError = xCompiled.error;
  const errorBody = xError && (
    <div className="flex flex-1 items-center justify-center p-3 text-center text-xs text-status-failed">
      <span>
        X expression <code className="mono">{xSrc}</code>: {xError.message}
      </span>
    </div>
  );

  return (
    <CardShell
      cardKind="scalar"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={SCALAR_POLICY.defaultHeight}
      onSettings={() => setExpanded(true)}
      onDownload={() => {
        const headers = ["series", "role", "x", "y", "wall_time"];
        const rows: (string | number)[][] = [];
        for (const s of series) {
          for (const p of s.points) {
            rows.push([s.label, s.role ?? "line", p.x, p.y, p.wallTime ?? ""]);
          }
        }
        downloadCsv(headers, rows, safeName(settings.title ?? metric.name) + ".csv");
      }}
      onScreenshot={() => {
        if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? metric.name));
      }}
      addToComparisonSlot={<AddToComparisonButton cardType="scalar" series={compSeries} />}
      addToReportSlot={<AddToReportButton cardType="scalar" series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      onRemove={onRemove}
      onResetView={resetViewport}
      viewModified={viewportModified}
      headerActions={
        <>
          {built.asOf && (
            <HeaderBadge
              tone="warn"
              title="Series logged at different steps were joined as of each step (each takes its last value at or before the step)"
            >
              as-of
            </HeaderBadge>
          )}
          {settings.smoothing > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center rounded touch:h-10"
              title="Smoothing on: open settings"
            >
              <HeaderBadge tone="accent">
                {SMOOTHING_KINDS[settings.smoothingKind].short} {formatSmoothing(settings.smoothingKind, settings.smoothing)}
              </HeaderBadge>
            </button>
          )}
          <HeaderToggle
            icon="fa-superscript"
            label={settings.yScale === "log" ? "Log y-scale (click for linear)" : "Linear y-scale (click for log)"}
            pressed={settings.yScale === "log"}
            onToggle={flipYScale}
          />
        </>
      }
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          <div className="flex flex-1 min-h-0 flex-col">
            {errorBody || <ScalarChart {...plotProps} className="h-full" />}
          </div>
        </div>
      }
    >
      <>
        {errorBody ||
          (isLoading && !hasData ? (
            <div className="flex-1 motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : (
            <ScalarChart {...plotProps} className="flex-1 min-h-0" />
          ))}

        <SeriesChipStrip
          metrics={effectiveMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => updateSettings({ metrics: next })}
          colorOf={(m, i) =>
            (multipleRuns ? runColors.get(m.runId ?? runId) : undefined) ?? SERIES_COLORS[i % SERIES_COLORS.length]!
          }
          className={series.length > 12 ? "max-h-24 overflow-y-auto" : undefined}
        />
      </>
    </CardShell>
  );
}
