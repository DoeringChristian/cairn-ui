/**
 * Parameter-importance card: which run params explain a target metric.
 *
 * One bar per param. "importance" is the permutation importance of a seeded
 * random forest; "correlation" is Pearson r (numeric params only). Bars are
 * coloured by the sign of the correlation (grey where there is none), so the
 * importance view still says which direction helps.
 *
 * Params come from the run details; the target is the run list's resolved
 * `values[metric]` (last scalar point, summary wins), the same number the
 * runs table shows, so no per-run sequence fetches.
 */

import { useMemo, useRef, useState } from "react";
import { useRuns, useRunsDetails } from "../api/hooks";
import BarChart, { type BarDatum } from "../charts/BarChart";
import { useCardSettings } from "../lib/card-settings";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { parameterImportance, MIN_RUNS, type ImportanceRow } from "../lib/plot-utils/importance.ts";
import { SERIES_COLORS, formatNum } from "../lib/plot-utils/types";
import { useProjectId } from "../lib/project-context";
import CardShell from "./CardShell";
import Select from "./settings/Select";
import type { BaseCardSettings } from "./card-kit";

type Method = "importance" | "correlation";

interface ImportanceSettings extends BaseCardSettings {
  metric: string | null;
  method: Method;
}

const DEFAULT_SETTINGS: ImportanceSettings = {
  version: 1,
  metric: null,
  method: "importance",
};

const POSITIVE = SERIES_COLORS[2]!;
const NEGATIVE = SERIES_COLORS[3]!;
const UNSIGNED = "#8b949e";

function parseParam(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string; contextHash: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function ImportanceCard({ runIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_SETTINGS);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const projectId = useProjectId();

  const details = useRunsDetails(runIds);
  const detailsKey = details.map((q) => q.dataUpdatedAt).join("|");
  const list = useRuns({ project: projectId ?? undefined, limit: 1000 });

  const paramsByRun = useMemo(() => {
    const out = new Map<string, Record<string, unknown>>();
    details.forEach((q, i) => {
      const rid = runIds[i];
      if (!rid || !q.data) return;
      const params: Record<string, unknown> = {};
      for (const p of q.data.params) params[p.key] = parseParam(p.value);
      out.set(rid, params);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, detailsKey]);

  const valuesByRun = useMemo(() => {
    const wanted = new Set(runIds);
    const out = new Map<string, Record<string, unknown>>();
    for (const r of list.data?.runs ?? []) if (wanted.has(r.id)) out.set(r.id, r.values ?? {});
    return out;
  }, [runIds, list.data]);

  const metricOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const values of valuesByRun.values()) {
      for (const [k, v] of Object.entries(values)) if (typeof v === "number") keys.add(k);
    }
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [valuesByRun]);

  const metric = settings.metric;

  const rows = useMemo<ImportanceRow[]>(() => {
    if (!metric) return [];
    const out: ImportanceRow[] = [];
    for (const rid of runIds) {
      const params = paramsByRun.get(rid);
      const target = valuesByRun.get(rid)?.[metric];
      if (!params || typeof target !== "number" || !Number.isFinite(target)) continue;
      out.push({ params, target });
    }
    return out;
  }, [metric, runIds, paramsByRun, valuesByRun]);

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

  const settingsPanel = (
    <>
      <div className="mb-2">
        <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">Metric</label>
        <select
          value={metric ?? ""}
          onChange={(e) => updateSettings({ metric: e.target.value || null })}
          className="input w-full text-xs"
        >
          <option value="">-- select metric --</option>
          {metric && !metricOptions.includes(metric) && <option value={metric}>{metric}</option>}
          {metricOptions.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      <Select<Method>
        label="Method"
        value={method}
        onChange={(v) => updateSettings({ method: v })}
        options={[
          { value: "importance", label: "Importance (random forest)" },
          { value: "correlation", label: "Correlation (Pearson r)" },
        ]}
        description={
          method === "importance"
            ? "Out-of-bag permutation importance of a 50-tree forest, relative to the metric's variance. Colour: sign of the correlation."
            : "Linear correlation with the metric; numeric params only."
        }
      />
    </>
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const loading = details.some((q) => q.isLoading) || list.isLoading;
  const message = !metric
    ? "Select a metric in settings to rank the parameters."
    : loading
      ? "Loading…"
      : rows.length < MIN_RUNS
        ? `Needs at least ${MIN_RUNS} runs with params and a value for ${metric}.`
        : bars.length === 0
          ? "No parameter varies across these runs."
          : null;

  const plotProps = {
    bars,
    valueLabel: method === "correlation" ? `r with ${metric}` : `importance for ${metric}`,
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
      updateSettings={updateSettings}
      title="Parameter Importance"
      subtitle={metric ? `${metric} · ${rows.length} runs` : `${runIds.length} runs`}
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
