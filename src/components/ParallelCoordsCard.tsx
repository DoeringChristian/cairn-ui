/**
 * Parallel coordinates card (wandb's): one axis per config key that varies
 * across the runs, then the chosen metric (its final value under the
 * project's summary rule); the axes are editable in the settings (config
 * keys and metrics, log scale per axis). One line per shown run, or per
 * innermost group in a grouped workspace (group means; a categorical value
 * only where the group's runs agree), lib/parallel-coords.ts.
 *
 * Lines are coloured by the last axis (a gradient) or by the run / group
 * colours. Drag along an axis to brush it (transient, not saved): the
 * matching lines stay coloured. Hovering a line shows its values and
 * lights up its row in the workspace sidebar (lib/workspace-runs/hover.ts).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import ParallelChart, { type ParallelChartAxis, type ParallelChartLine } from "../charts/ParallelChart";
import { sampleColormap } from "../charts/colormaps";
import { useMetricRules } from "../api/hooks";
import { useCardSettings } from "../lib/card-settings";
import { cardMetric, metricKeys } from "../lib/card-metric";
import { downloadCsv, safeName } from "../lib/download";
import { axisScale, defaultAxes, linesOf, position, type Brush, type ParallelAxis } from "../lib/parallel-coords";
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
  const axes = useMemo<ParallelAxis[]>(() => (Array.isArray(s.axes) ? s.axes : defaultAxes(runs, metric)), [s.axes, runs, metric]);

  const units = useMemo(() => unitsOf(runs, groupOf), [runs, groupOf]);
  const lines = useMemo(() => linesOf(units, axes), [units, axes]);
  const scales = useMemo(() => axes.map((a, i) => axisScale(lines.map((l) => l.values[i] ?? null), !!a.log)), [axes, lines]);

  // Brushes are transient: they go with the axes they were drawn on.
  const axesKey = JSON.stringify(axes);
  const [brushes, setBrushes] = useState<ReadonlyMap<number, Brush>>(new Map());
  useEffect(() => setBrushes(new Map()), [axesKey]);
  const onBrush = (axis: number, b: Brush | null) =>
    setBrushes((prev) => {
      const next = new Map(prev);
      if (b) next.set(axis, b);
      else next.delete(axis);
      return next;
    });

  const chartAxes = useMemo<ParallelChartAxis[]>(() => axes.map((a, i) => ({ label: a.key, scale: scales[i]! })), [axes, scales]);
  const chartLines = useMemo<ParallelChartLine[]>(() => {
    const last = axes.length - 1;
    return lines.map((l) => {
      const positions = l.values.map((v, i) => position(scales[i]!, v));
      const t = last >= 0 ? positions[last] : null;
      const color = s.color === "runs" ? (colorOf(l.unit) ?? NO_VALUE) : t == null ? NO_VALUE : sampleColormap("turbo", 0.1 + 0.8 * t);
      return { key: l.key, label: labelOf(l.unit), color, positions, values: l.values };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, scales, axes.length, s.color, colorOf, labelOf]);

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
        : axes.length === 0
          ? "No config key varies and no metric is logged: add axes in the settings."
          : null;

  const body = (className: string) =>
    message ? (
      <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>{message}</div>
    ) : (
      <div className={`flex flex-col ${className}`}>
        <ParallelChart
          axes={chartAxes}
          lines={chartLines}
          brushes={brushes}
          onBrush={onBrush}
          hot={hot != null && chartLines.some((l) => l.key === hot) ? hot : null}
          onHover={onHover}
          className="min-h-0 flex-1"
        />
        <p className="pt-1 text-xs text-fg-subtle">
          drag along an axis to brush · {units.length} {unitWord}
        </p>
      </div>
    );

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
      modalContent={<div className="flex h-[calc(100vh-12rem)] flex-col">{body("flex-1 min-h-0")}</div>}
    >
      {body("flex-1 min-h-0")}
    </CardShell>
  );
}
