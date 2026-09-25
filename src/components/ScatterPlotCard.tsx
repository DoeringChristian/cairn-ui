import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCardSettings } from "../lib/card-settings";
import { instanceDefaults, type ScatterSettings } from "./cards-settings/scatter";
import ScatterChart, { type ScatterPoint } from "../charts/ScatterChart";
import type { Better, ParetoDirection } from "../lib/plot-utils/pareto";
import { summaryRuleFor } from "../lib/metric-defs";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { ruleDirection, templateSrcs, toNumber, toText } from "../lib/scalar-exprs";
import { formatValue, renderTemplate } from "../lib/expr";
import CardShell from "./CardShell";
import ScatterSettingsPanel from "./settings-panels/ScatterSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
  /** Settings a fresh card starts from (e.g. a sweep's params and metric). */
  defaults?: Partial<ScatterSettings>;
}

export default function ScatterPlotCard({
  runIds: allRunIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
  defaults,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();
  const navigate = useNavigate();

  const ctl = useCardSettings<ScatterSettings>(settingsKey, "scatter", instanceDefaults(defaults));
  const settings = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const runIds = useVisibleRuns(allRunIds);
  const runColors = useRunColors(runIds);

  // Axes and colour, then the tooltip fields, then the label template's holes.
  const labelSrcs = useMemo(() => templateSrcs(settings.labelTemplate), [settings.labelTemplate]);
  const srcs = useMemo(
    () => [
      settings.x?.src ?? "",
      settings.y?.src ?? "",
      settings.color?.src ?? "",
      ...settings.tooltipFields,
      ...labelSrcs,
    ],
    [settings.x, settings.y, settings.color, settings.tooltipFields, labelSrcs],
  );
  const exprs = useScalarExprs(runIds, srcs);

  const points = useMemo(() => {
    const [xs, ys, cs] = exprs.values as [Map<string, unknown>, Map<string, unknown>, Map<string, unknown>];
    const pts: ScatterPoint[] = [];
    for (const rid of runIds) {
      const x = toNumber(xs.get(rid));
      const y = toNumber(ys.get(rid));
      if (x == null || y == null) continue;
      let label = shortRunLabel(rid, runIds);
      const ctx = exprs.contexts.get(rid);
      if (settings.labelTemplate.trim() && ctx) {
        try {
          label = renderTemplate(settings.labelTemplate, ctx) || label;
        } catch {
          // An invalid template (the settings show why) keeps the run label.
        }
      }
      pts.push({
        id: rid,
        x,
        y,
        color: settings.color ? toNumber(cs.get(rid)) : null,
        runColor: runColors.get(rid) ?? "#8b949e",
        label,
        extra: settings.tooltipFields.map((src, i) => [src, formatValue(exprs.values[3 + i]?.get(rid) ?? null)]),
      });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exprs, runIds, runColors, settings.color, settings.labelTemplate, settings.tooltipFields, runMetaVersion]);

  // Pareto direction per axis: the setting, else the metric's summary rule
  // ("max" = higher is better), else lower is better.
  const ruleOf = (metric: string) => {
    for (const d of exprs.details.values()) {
      const rule = summaryRuleFor(metric, d.metric_defs);
      if (rule) return rule;
    }
    return null;
  };
  const paretoAuto: { x: Better; y: Better } = {
    x: (settings.x && ruleDirection(settings.x.src, ruleOf)) || "min",
    y: (settings.y && ruleDirection(settings.y.src, ruleOf)) || "min",
  };
  const paretoX = settings.paretoX ?? paretoAuto.x;
  const paretoY = settings.paretoY ?? paretoAuto.y;
  const pareto = useMemo<ParetoDirection | undefined>(
    () => (settings.showPareto ? { x: paretoX, y: paretoY } : undefined),
    [settings.showPareto, paretoX, paretoY],
  );

  const errors = {
    x: settings.x ? exprs.errors[0] ?? null : null,
    y: settings.y ? exprs.errors[1] ?? null : null,
    color: settings.color ? exprs.errors[2] ?? null : null,
  };
  const asof = exprs.asofJoin.slice(0, 3).some(Boolean);

  const settingsPanel = (
    <ScatterSettingsPanel ctl={ctl} mode="card" ctx={{ options: exprs.options, paretoAuto, errors }} />
  );

  const openRun = (rid: string) => {
    const pid = exprs.details.get(rid)?.run.project_id;
    if (pid) navigate(`/p/${pid}/r/${rid}`);
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const noAxes = !settings.x || !settings.y;

  const plotProps = {
    points,
    xLabel: settings.x?.src,
    yLabel: settings.y?.src,
    colorLabel: settings.color?.src,
    xRange: settings.xRange,
    yRange: settings.yRange,
    pareto,
    dimNonFrontier: settings.dimNonFrontier,
    running: settings.running,
    regression: settings.regression,
    refLines: settings.refLines,
    onPointClick: openRun,
  };

  const empty = (className: string) => (
    <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>
      {noAxes
        ? "Select X and Y axes in settings to create the scatter plot."
        : errors.x || errors.y
          ? `Invalid axis: ${errors.x ?? errors.y}`
          : exprs.loading
            ? "Loading…"
            : "No run has a value on both axes."}
    </div>
  );

  return (
    <CardShell cardKind="scatter"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title="Scatter Plot"
      subtitle={
        <span title={asof ? "An axis joins series logged at different steps (as-of join)" : undefined}>
          {`${points.length} points`}
          {asof && <span className="ml-1 text-status-running">· as-of join</span>}
        </span>
      }
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", "label", settings.x?.src ?? "x", settings.y?.src ?? "y"];
        if (settings.color) headers.push(settings.color.src);
        headers.push(...settings.tooltipFields);
        const rows: (string | number)[][] = points.map((pt) => {
          const row: (string | number)[] = [pt.id, pt.label, pt.x, pt.y];
          if (settings.color) row.push(pt.color ?? "");
          settings.tooltipFields.forEach((_, i) => row.push(toText(exprs.values[3 + i]?.get(pt.id)) ?? ""));
          return row;
        });
        downloadCsv(headers, rows, safeName(settings.title ?? "scatter_plot") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "scatter_plot")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          {points.length === 0 ? empty("flex-1") : <ScatterChart {...plotProps} className="flex-1 min-h-0" />}
        </div>
      }
    >
      {points.length === 0 ? empty("flex-1 min-h-0") : <ScatterChart {...plotProps} className="rounded bg-bg flex-1 min-h-0" />}
    </CardShell>
  );
}
