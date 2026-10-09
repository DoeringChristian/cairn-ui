/**
 * Parallel coordinates card (wandb's): one axis per config key that varies
 * across the runs, then the chosen metric (its final value under the
 * project's summary rule); the axes are editable in the settings (config
 * keys and metrics, log scale per axis). When more default axes vary than
 * the card's width holds (`MIN_AXIS_GAP` apart), it shows the metric and
 * the config keys the runs vary most along (lib/parallel-coords.ts
 * `fitDefaultAxes`), the rest addable in the settings; the expanded card,
 * wider, shows more. One line per shown run, or per
 * innermost group in a grouped workspace (group means; a categorical value
 * only where the group's runs agree), lib/parallel-coords.ts.
 *
 * Lines are coloured by the last axis (a gradient) or by the run / group
 * colours. Drag along an axis to brush it (transient, not saved): the
 * matching lines stay coloured. Hovering a line shows its values and
 * lights up its row in the workspace sidebar (lib/workspace-runs/hover.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ParallelChart, { type ParallelChartAxis, type ParallelChartLine } from "../charts/ParallelChart";
import { sampleColormap } from "../charts/colormaps";
import { useMetricRules } from "../api/hooks";
import { useCardSettings } from "../lib/card-settings";
import { cardMetric, metricKeys } from "../lib/card-metric";
import { downloadCsv, safeName } from "../lib/download";
import { axesThatFit, axisScale, defaultAxes, fitDefaultAxes, linesOf, position, type Brush, type ParallelAxis } from "../lib/parallel-coords";
import { useProjectId } from "../lib/project-context";
import { unitsOf, type Unit } from "../lib/summary-tables";
import { useRunHover, type HoverTarget } from "../lib/workspace-runs/hover";
import { instanceDefaults, type ParallelSettings } from "./cards-settings/parallel";
import CardShell from "./CardShell";
import ParallelSettingsPanel from "./settings-panels/ParallelSettingsPanel";
import { useSummaryRuns } from "./summary/use-summary-runs";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
  /** Settings a fresh card starts from (e.g. a sweep's params and metric). */
  defaults?: Partial<ParallelSettings>;
}

const NO_VALUE = "#8b949e";

const targetOf = (u: Unit): HoverTarget => (u.kind === "group" ? { group: u.group } : { runId: u.runId });

export default function ParallelCoordsCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings, defaults }: Props) {
  const ctl = useCardSettings<ParallelSettings>(settingsKey, "parallel", instanceDefaults(defaults));
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const { runIds, runs, loading, groupOf, labelOf, colorOf } = useSummaryRuns(allRunIds);
  const ruleOf = useMetricRules(useProjectId());
  const hover = useRunHover();

  const metrics = useMemo(() => metricKeys(runs), [runs]);
  const configKeys = useMemo(() => [...new Set(runs.flatMap((r) => Object.keys(r.config)))].sort(), [runs]);
  const metric = cardMetric(typeof s.metric === "string" ? s.metric : null, metrics, ruleOf);
  const all = useMemo<ParallelAxis[]>(() => (Array.isArray(s.axes) ? s.axes : defaultAxes(runs, metric)), [s.axes, runs, metric]);
  // The card's and the expanded card's plot widths: the default axes that fit each.
  const [spans, setSpans] = useState({ card: 0, modal: 0 });
  const onCardSpan = useCallback((span: number) => setSpans((p) => (p.card === span ? p : { ...p, card: span })), []);
  const onModalSpan = useCallback((span: number) => setSpans((p) => (p.modal === span ? p : { ...p, modal: span })), []);
  const fit = (span: number) => (Array.isArray(s.axes) || span <= 0 ? all : fitDefaultAxes(all, runs, axesThatFit(span)));
  const cardAxes = useMemo(() => fit(spans.card), [all, runs, spans.card]); // eslint-disable-line react-hooks/exhaustive-deps
  const modalAxes = useMemo(() => fit(spans.modal), [all, runs, spans.modal]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = useMemo(() => unitsOf(runs, groupOf), [runs, groupOf]);

  // Brushes are transient (keyed by axis): they go when the axes are edited.
  const axesKey = JSON.stringify(s.axes);
  const [brushes, setBrushes] = useState<ReadonlyMap<string, Brush>>(new Map());
  useEffect(() => setBrushes(new Map()), [axesKey]);
  const onBrush = (id: string, b: Brush | null) =>
    setBrushes((prev) => {
      const next = new Map(prev);
      if (b) next.set(id, b);
      else next.delete(id);
      return next;
    });

  const card = useChartModel(cardAxes, units, s.color, colorOf, labelOf, brushes);
  const modal = useChartModel(modalAxes, units, s.color, colorOf, labelOf, brushes);

  const unitByKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const t = hover.target;
  const hot = t == null ? null : t.group != null ? `group:${t.group}` : `run:${t.runId}`;
  const onHover = (line: ParallelChartLine | null) => {
    const u = line ? unitByKey.get(line.key) : undefined;
    hover.set(u ? targetOf(u) : null);
  };

  const unitWord = groupOf ? (units.length === 1 ? "line" : "lines") : units.length === 1 ? "run" : "runs";
  const message =
    runIds.length === 0
      ? "No runs."
      : loading && runs.length === 0
        ? "Loading…"
        : all.length === 0
          ? "No config key varies and no metric is logged: add axes in the settings."
          : null;

  const body = (m: ChartModel, onSpan: (span: number) => void, className: string) =>
    message ? (
      <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>{message}</div>
    ) : (
      <div className={`flex flex-col ${className}`}>
        <ParallelChart
          axes={m.chartAxes}
          lines={m.chartLines}
          brushes={m.brushes}
          onBrush={(i, b) => onBrush(axisId(m.axes[i]!), b)}
          hot={hot != null && m.chartLines.some((l) => l.key === hot) ? hot : null}
          onHover={onHover}
          onSpan={onSpan}
          className="min-h-0 flex-1"
        />
        <p className="pt-1 text-xs text-fg-subtle">
          drag along an axis to brush · {units.length} {unitWord}
          {m.axes.length < all.length && ` · ${m.axes.length} of ${all.length} axes (add more in the settings)`}
        </p>
      </div>
    );
  const axes = cardAxes;
  const lines = card.lines;

  const cardRef = useRef<HTMLDivElement>(null);
  const settingsPanel = <ParallelSettingsPanel ctl={ctl} mode="card" ctx={{ metrics, configKeys, metric, axes }} />;

  return (
    <CardShell
      cardKind="parallel"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title="Parallel coordinates"
      defaultHeight={320}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const rows: (string | number)[][] = lines.map((l) => [labelOf(l.unit), ...l.values.map((v) => (v == null ? "" : typeof v === "number" ? v : String(v)))]);
        downloadCsv(["run", ...axes.map((a) => a.key)], rows, safeName(s.title ?? "parallel_coordinates") + ".csv");
      }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-[calc(100vh-12rem)] flex-col">{body(modal, onModalSpan, "flex-1 min-h-0")}</div>}
    >
      {body(card, onCardSpan, "flex-1 min-h-0")}
    </CardShell>
  );
}

const axisId = (a: ParallelAxis) => `${a.kind}:${a.key}`;

interface ChartModel {
  axes: ParallelAxis[];
  lines: ReturnType<typeof linesOf>;
  chartAxes: ParallelChartAxis[];
  chartLines: ParallelChartLine[];
  /** The brushes by axis index. */
  brushes: ReadonlyMap<number, Brush>;
}

/** The lines and scales over `axes`, coloured by the last axis or the run / group colours. */
function useChartModel(
  axes: ParallelAxis[],
  units: Unit[],
  color: ParallelSettings["color"],
  colorOf: (u: Unit) => string | null | undefined,
  labelOf: (u: Unit) => string,
  brushById: ReadonlyMap<string, Brush>,
): ChartModel {
  const brushes = useMemo(
    () => new Map(axes.flatMap((a, i) => { const b = brushById.get(axisId(a)); return b ? [[i, b] as const] : []; })),
    [axes, brushById],
  );
  const lines = useMemo(() => linesOf(units, axes), [units, axes]);
  const scales = useMemo(() => axes.map((a, i) => axisScale(lines.map((l) => l.values[i] ?? null), !!a.log)), [axes, lines]);
  const chartAxes = useMemo<ParallelChartAxis[]>(() => axes.map((a, i) => ({ label: a.key, scale: scales[i]! })), [axes, scales]);
  const chartLines = useMemo<ParallelChartLine[]>(() => {
    const last = axes.length - 1;
    return lines.map((l) => {
      const positions = l.values.map((v, i) => position(scales[i]!, v));
      const t = last >= 0 ? positions[last] : null;
      const c = color === "runs" ? (colorOf(l.unit) ?? NO_VALUE) : t == null ? NO_VALUE : sampleColormap("turbo", 0.1 + 0.8 * t);
      return { key: l.key, label: labelOf(l.unit), color: c, positions, values: l.values };
    });
  }, [lines, scales, axes.length, color, colorOf, labelOf]);
  return { axes, lines, chartAxes, chartLines, brushes };
}
