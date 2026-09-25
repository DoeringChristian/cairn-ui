/**
 * Parameter-importance card: which run params explain a target metric.
 *
 * One bar per param. "importance" is the permutation importance of a seeded
 * random forest; "correlation" is Pearson r (numeric params only). Bars are
 * coloured by the sign of the correlation (grey where there is none), so the
 * importance view still says which direction helps.
 *
 * Params come from the run details; the target is a scalar expression per
 * run (`min(val.loss)`, `last(acc)`, …), answered from the runs' stats when
 * it only reduces metrics, so usually no per-run sequence fetches.
 */

import { useMemo, useRef, useState } from "react";
import BarChart, { type BarDatum } from "../charts/BarChart";
import { useCardSettings } from "../lib/card-settings";
import type { ImportanceSettings } from "./cards-settings/importance";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { parameterImportance, MIN_RUNS, type ImportanceRow } from "../lib/plot-utils/importance.ts";
import { SERIES_COLORS, formatNum } from "../lib/plot-utils/types";
import { useVisibleRuns } from "../lib/run-view";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { toNumber } from "../lib/scalar-exprs";
import { useRunInfo } from "./card-kit/use-run-info";
import CardShell from "./CardShell";
import ImportanceSettingsPanel from "./settings-panels/ImportanceSettingsPanel";


const POSITIVE = SERIES_COLORS[2]!;
const NEGATIVE = SERIES_COLORS[3]!;
const UNSIGNED = "#8b949e";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function ImportanceCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<ImportanceSettings>(settingsKey, "importance");
  const settings = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const runIds = useVisibleRuns(allRunIds);

  const metric = settings.metric;
  const srcs = useMemo(() => [metric?.src ?? ""], [metric]);
  const exprs = useScalarExprs(runIds, srcs);
  const { paramsByRunId } = useRunInfo(runIds);

  // The params are the inputs: offer metrics and summary keys as the target.
  const targetOptions = useMemo(() => exprs.options.filter((o) => o.kind !== "param"), [exprs.options]);

  const rows = useMemo<ImportanceRow[]>(() => {
    if (!metric) return [];
    const out: ImportanceRow[] = [];
    for (const rid of runIds) {
      const params = paramsByRunId.get(rid);
      const target = toNumber(exprs.values[0]!.get(rid));
      if (!params || target == null) continue;
      out.push({ params, target });
    }
    return out;
  }, [metric, runIds, paramsByRunId, exprs]);

  const scores = useMemo(() => parameterImportance(rows), [rows]);

  const method = settings.method;
  const bars = useMemo<BarDatum[]>(() => {
    const shown = method === "correlation" ? scores.filter((s) => s.pearson != null) : scores;
    const sorted = method === "correlation"
      ? [...shown].sort((a, b) => Math.abs(b.pearson!) - Math.abs(a.pearson!))
      : shown;
    return sorted.map((s) => ({
      id: s.key,
      label: s.key,
      value: method === "correlation" ? s.pearson! : s.importance,
      color: s.pearson == null ? UNSIGNED : s.pearson >= 0 ? POSITIVE : NEGATIVE,
    }));
  }, [scores, method]);

  const error = metric ? exprs.errors[0] ?? null : null;
  const settingsPanel = (
    <ImportanceSettingsPanel ctl={ctl} mode="card" ctx={{ options: targetOptions, error }} />
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const target = metric?.src;
  const message = !metric
    ? "Select a target in settings to rank the parameters."
    : error
      ? `Invalid target: ${error}`
      : exprs.loading
        ? "Loading…"
        : rows.length < MIN_RUNS
          ? `Needs at least ${MIN_RUNS} runs with params and a value for ${target}.`
          : bars.length === 0
            ? "No parameter varies across these runs."
            : null;

  const plotProps = {
    bars,
    valueLabel: method === "correlation" ? `r with ${target}` : `importance for ${target}`,
    compareMode: "grouped" as const,
    runOrder: bars.map((b) => b.id),
  };

  const body = (className: string) =>
    message ? (
      <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>{message}</div>
    ) : (
      <BarChart {...plotProps} className={className} />
    );

  return (
    <CardShell cardKind="importance"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title="Parameter Importance"
      subtitle={target ? `${target} · ${rows.length} runs` : `${runIds.length} runs`}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["param", "kind", "importance", "pearson", "spearman"];
        const csv: (string | number)[][] = scores.map((s) => [
          s.key,
          s.kind,
          formatNum(s.importance),
          s.pearson == null ? "" : formatNum(s.pearson),
          s.spearman == null ? "" : formatNum(s.spearman),
        ]);
        downloadCsv(headers, csv, safeName(settings.title ?? "parameter_importance") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "parameter_importance")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex flex-col h-[calc(100vh-12rem)]">{body("flex-1 min-h-0")}</div>}
    >
      {body("rounded bg-bg flex-1 min-h-0")}
    </CardShell>
  );
}
