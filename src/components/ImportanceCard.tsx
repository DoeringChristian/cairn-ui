/**
 * Parameter importance card (wandb's): which config keys explain a metric.
 *
 * The metric (picked in the title) is each run's final value under the
 * project's summary rule (`run.values`). One row per config key that varies:
 * its importance (a seeded random forest's impurity-based importance, the
 * keys' scores summing to 1) and its Pearson correlation with the metric
 * (numeric keys; "—" otherwise), green when raising the key moves the metric
 * the way its goal wants, red the other way, neutral without a goal
 * (lib/plot-utils/importance.ts). Rows sort by importance or by the
 * correlation's strength (click a header).
 *
 * Grouped workspace: the runs of the shown groups (not their means).
 */

import { useMemo, useRef, useState } from "react";
import { useMetricRules } from "../api/hooks";
import { useCardSettings } from "../lib/card-settings";
import { cardMetric, metricKeys } from "../lib/card-metric";
import { downloadCsv, safeName } from "../lib/download";
import { correlationTone, MIN_RUNS, parameterImportance, sortImportance, type ImportanceRow, type ImportanceSort, type Tone } from "../lib/plot-utils/importance";
import { formatNum } from "../lib/plot-utils/format";
import { useProjectId } from "../lib/project-context";
import type { ImportanceSettings } from "./cards-settings/importance";
import CardShell from "./CardShell";
import FieldList from "./settings/palette/FieldList";
import type { FieldOption } from "./settings/palette";
import Popover from "./ui/Popover";
import ImportanceSettingsPanel from "./settings-panels/ImportanceSettingsPanel";
import { useSummaryRuns } from "./summary/use-summary-runs";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  good: "bg-status-completed",
  bad: "bg-status-failed",
  neutral: "bg-fg-subtle",
};

/** `+0.71`, `−0.33`. */
function signed(r: number): string {
  const t = Math.abs(r).toFixed(2);
  return r < 0 ? `−${t}` : `+${t}`;
}

/** The metric picker in the title: the metric and ▾, a searchable list. */
function MetricPicker({ value, options, onChange, disabled }: { value: string | null; options: string[]; onChange: (m: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const fields = useMemo<FieldOption[]>(() => options.map((m) => ({ key: m, kind: "metric", label: m })), [options]);
  if (value == null) return null;
  // Read-only (a report, a preview): the metric as text.
  if (disabled) return <span className="mono text-sm font-semibold">{value}</span>;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Metric: ${value}`}
        onClick={() => setOpen((v) => !v)}
        className="mono inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-sm font-semibold text-fg hover:border-fg-subtle disabled:cursor-default"
      >
        {value}
        <i aria-hidden="true" className="fa-solid fa-chevron-down text-[9px] text-fg-subtle" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} title="Metric" width={288} align="start">
        <FieldList
          options={fields}
          selected={value}
          onPick={(o) => {
            onChange(o.key);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

export default function ImportanceCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<ImportanceSettings>(settingsKey, "importance");
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const { runIds, runs, loading } = useSummaryRuns(allRunIds);
  const ruleOf = useMetricRules(useProjectId());

  const metrics = useMemo(() => metricKeys(runs), [runs]);
  const metric = cardMetric(typeof s.metric === "string" ? s.metric : null, metrics, ruleOf);

  const rows = useMemo<ImportanceRow[]>(() => {
    if (!metric) return [];
    const out: ImportanceRow[] = [];
    for (const r of runs) {
      const v = r.values[metric];
      if (typeof v === "number" && Number.isFinite(v)) out.push({ params: r.config, target: v });
    }
    return out;
  }, [runs, metric]);
  // Fit once the runs are in, and again only when the rows' content changes:
  // refitting the forest (0.3 s at 1000 runs) as each run's details landed,
  // or were refetched unchanged, took the page for tens of seconds.
  const rowsKey = useMemo(() => JSON.stringify(rows), [rows]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scores = useMemo(() => (loading ? [] : parameterImportance(rows)), [rowsKey, loading]);
  const sorted = useMemo(() => sortImportance(scores, s.sort), [scores, s.sort]);
  const goal = metric ? ruleOf(metric).goal : "none";

  const message =
    runIds.length === 0
      ? "No runs."
      : loading
        ? "Loading…"
        : !metric
          ? "No metric logged on these runs."
          : rows.length < MIN_RUNS
            ? `Needs at least ${MIN_RUNS} runs with ${metric}`
            : sorted.length === 0
              ? "No config key varies across these runs."
              : null;

  const header = (key: ImportanceSort, label: string) => {
    const on = s.sort === key;
    return (
      <th className="pb-1 pr-4 font-medium" aria-sort={on ? "descending" : "none"}>
        <button
          type="button"
          disabled={ctl.locked}
          onClick={() => ctl.set({ sort: key })}
          className={`inline-flex items-center gap-1 hover:text-fg ${on ? "text-fg" : ""}`}
          title={`Sort by ${label.toLowerCase()}`}
        >
          {label}
          {on && <i className="fa-solid fa-arrow-down text-[10px]" aria-hidden="true" />}
        </button>
      </th>
    );
  };

  const body = (className: string) =>
    message ? (
      <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>{message}</div>
    ) : (
      <div className={`flex flex-col ${className}`}>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm" data-testid="importance-table">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 font-medium">Parameter</th>
                {header("importance", "Importance")}
                {header("correlation", "Correlation")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const tone = correlationTone(p.correlation, goal);
                return (
                  <tr key={p.key} className="border-t border-border-subtle">
                    <td className="mono max-w-[16rem] truncate py-1 pr-4" title={p.key}>
                      {p.key}
                    </td>
                    <td className="py-1 pr-4">
                      <span className="inline-flex items-center gap-2">
                        <span className="relative h-2.5 w-24 overflow-hidden rounded-sm bg-bg-hover">
                          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.max(0, Math.min(1, p.importance)) * 100}%` }} />
                        </span>
                        <span className="mono w-10 text-right tabular-nums">{p.importance.toFixed(2)}</span>
                      </span>
                    </td>
                    <td className="py-1 pr-4">
                      {p.correlation == null ? (
                        <span className="text-fg-subtle" title="Not a number: no correlation">
                          —
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2" data-tone={tone}>
                          <span className="relative h-2.5 w-16 overflow-hidden rounded-sm bg-bg-hover">
                            <span className={`absolute inset-y-0 left-0 ${TONE_CLASS[tone]}`} style={{ width: `${Math.abs(p.correlation) * 100}%` }} />
                          </span>
                          <span className="mono w-12 text-right tabular-nums">{signed(p.correlation)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="pt-1 text-xs text-fg-subtle">{rows.length} runs · random forest + correlation</p>
      </div>
    );

  const cardRef = useRef<HTMLDivElement>(null);
  const settingsPanel = <ImportanceSettingsPanel ctl={ctl} mode="card" ctx={{ metrics, metric }} />;

  return (
    <CardShell
      cardKind="importance"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title="Parameter importance for"
      titleAddon={<MetricPicker value={metric} options={metrics} disabled={ctl.locked} onChange={(m) => ctl.set({ metric: m })} />}
      defaultHeight={300}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const csv: (string | number)[][] = sorted.map((p) => [p.key, p.kind, formatNum(p.importance), p.correlation == null ? "" : formatNum(p.correlation)]);
        downloadCsv(["param", "kind", "importance", "correlation"], csv, safeName(s.title ?? `parameter_importance_${metric ?? ""}`) + ".csv");
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
