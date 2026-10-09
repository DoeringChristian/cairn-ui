/**
 * Scalars card (the Summary section): one table of every metric logged at a
 * single step, the runs' `summary` values (headers in italics) and run info
 * (status, duration, created, user, host; "show run info"). One row per
 * shown run, or per innermost group when the workspace is grouped (a
 * group's mean; lib/summary-tables.ts). Click a header to sort by it. A
 * metric column's ▾ menu sorts, sets the project's rule for the metric
 * (summary, goal; components/MetricColumnMenu.tsx) and hides the column;
 * with a goal, the best row is green and the worst red.
 */

import { useMemo, useRef, useState } from "react";
import type { RunStatus } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import { downloadCsv, safeName } from "../lib/download";
import { isSystemMetric } from "../lib/metric-defs";
import { formatSeconds } from "../lib/format";
import { formatValue } from "../lib/plot-utils/format";
import { bestWorst, MIXED, nextSort, scalarsTable, sortRows, type Cell, type Column, type Mark, type ScalarsRow } from "../lib/summary-tables";
import { useMetricRules } from "../api/hooks";
import { useProjectId } from "../lib/project-context";
import MetricColumnMenu from "./MetricColumnMenu";
import Popover from "./ui/Popover";
import { isSingleStepScalar } from "../lib/workspace/summary-cards";
import CardShell from "./CardShell";
import RunStatusBadge from "./RunStatusBadge";
import type { ScalarsSettings } from "./cards-settings/scalars";
import ScalarsSettingsPanel from "./settings-panels/ScalarsSettingsPanel";
import { EmptyCell, UnitLabel, useSummaryRuns } from "./summary/use-summary-runs";
import { useWorkspaceMetrics } from "./workspace/use-workspace-metrics";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/** Best / worst cells: the run comparer's tints (lib/table-diff.ts `diffCellClassName`). */
const MARK_CLASS: Record<NonNullable<Mark> | "none", string> = { best: "bg-green-900/30", worst: "bg-red-900/30", none: "" };

const STATUSES = new Set<string>(["running", "completed", "failed", "crashed", "killed", "stopped"]);

/** One formatter for every row (`toLocaleString` with options builds one per call). */
const CREATED = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function cellText(col: Column, v: Cell): string {
  if (v == null) return "";
  if (v === MIXED) return "mixed";
  if (col.key === "info:duration" && typeof v === "number") return formatSeconds(v);
  if (col.key === "info:created" && typeof v === "number") {
    return CREATED.format(new Date(v));
  }
  return formatValue(v);
}

function CellView({ col, v }: { col: Column; v: Cell }) {
  if (v == null || v === MIXED) return <EmptyCell mixed={v === MIXED} />;
  if (col.key === "info:status" && typeof v === "string" && STATUSES.has(v)) return <RunStatusBadge status={v as RunStatus} />;
  return <>{cellText(col, v)}</>;
}

export default function ScalarsCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<ScalarsSettings>(settingsKey, "scalars");
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const { runIds, runs, loading, groupOf, labelOf, colorOf } = useSummaryRuns(allRunIds);
  const { metrics } = useWorkspaceMetrics(runIds);
  const singleStep = useMemo(
    () => metrics.filter((m) => isSingleStepScalar(m) && !isSystemMetric(m.name)).map((m) => m.name),
    [metrics],
  );
  const table = useMemo(
    () => scalarsTable(runs, { singleStep, groupOf, showRunInfo: s.showRunInfo, now: Date.now() }),
    [runs, singleStep, groupOf, s.showRunInfo],
  );
  const hidden = useMemo(() => new Set(s.hidden ?? []), [s.hidden]);
  const columns = useMemo(() => table.columns.filter((c) => !hidden.has(c.key)), [table.columns, hidden]);
  const sort = s.sort && (s.sort.key === "label" || columns.some((c) => c.key === s.sort!.key)) ? s.sort : null;
  const rows = useMemo(() => sortRows(table.rows, sort, (r) => labelOf(r.unit)), [table.rows, sort, labelOf]);
  const cardRef = useRef<HTMLDivElement>(null);
  const projectId = useProjectId();
  const ruleOf = useMetricRules(projectId);
  // Metric columns with a goal: the best row green, the worst red (as the run comparer).
  const marks = useMemo(() => {
    const out = new Map<string, Mark[]>();
    for (const c of columns) {
      if (c.kind !== "metric") continue;
      const m = bestWorst(rows.map((r) => r.cells[c.key] ?? null), ruleOf(c.label).goal);
      if (m.some((x) => x !== null)) out.set(c.key, m);
    }
    return out;
  }, [columns, rows, ruleOf]);
  const [menu, setMenu] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const menuColumn = columns.find((c) => c.key === menu) ?? null;

  const header = (key: string, label: string, title?: string, italic = false, metric = false) => {
    const on = sort?.key === key;
    return (
      <th key={key} className="sticky top-0 z-10 bg-bg pb-1 pr-4 font-medium whitespace-nowrap" aria-sort={on ? (sort!.desc ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => ctl.set({ sort: nextSort(sort, key) })}
          disabled={ctl.locked}
          className={`inline-flex items-center gap-1 hover:text-fg ${italic ? "italic" : ""} ${on ? "text-fg" : ""}`}
          title={title}
        >
          {label}
          <i
            className={`fa-solid ${on ? (sort!.desc ? "fa-sort-down" : "fa-sort-up") : "fa-sort opacity-30"} text-[10px]`}
            aria-hidden="true"
          />
        </button>
        {metric && (
          <button
            type="button"
            className="ml-0.5 rounded px-1 text-fg-subtle hover:bg-bg-hover hover:text-fg"
            aria-label={`Column options for ${label}`}
            onClick={(e) => {
              menuAnchor.current = e.currentTarget;
              setMenu((m) => (m === key ? null : key));
            }}
          >
            <i className="fa-solid fa-caret-down text-[10px]" aria-hidden="true" />
          </button>
        )}
      </th>
    );
  };

  const body = (className: string) => {
    if (runIds.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>No runs.</p>;
    if (loading && runs.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>Loading…</p>;
    return (
      <div className={`overflow-auto ${className}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              {header("label", "", "Sort by name")}
              {columns.map((c) =>
                header(
                  c.key,
                  c.label,
                  c.kind === "summary" ? `${c.label}: a summary value (run.summary)` : undefined,
                  c.kind === "summary",
                  c.kind === "metric",
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ScalarsRow, ri) => (
              <tr key={r.unit.key} className="border-t border-border-subtle">
                <td className="sticky left-0 bg-bg py-1 pr-4">
                  <UnitLabel label={labelOf(r.unit)} color={colorOf(r.unit)} />
                </td>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`py-1 pr-4 whitespace-nowrap ${c.kind === "info" ? "text-fg-muted" : "mono tabular-nums"} ${MARK_CLASS[marks.get(c.key)?.[ri] ?? "none"]}`}
                    data-mark={marks.get(c.key)?.[ri] ?? undefined}
                  >
                    <CellView col={c} v={r.cells[c.key] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Popover
          open={menuColumn !== null}
          onClose={() => setMenu(null)}
          anchorRef={menuAnchor}
          title={menuColumn?.label ?? ""}
          titleAnchored
          width={280}
          align="start"
          role="menu"
          bodyClassName="p-1"
        >
          {menuColumn && (
            <MetricColumnMenu
              projectId={projectId}
              metric={menuColumn.label}
              onSort={(direction) => !ctl.locked && ctl.set({ sort: { key: menuColumn.key, desc: direction === "desc" } })}
              onHide={() => !ctl.locked && ctl.set({ hidden: [...(s.hidden ?? []), menuColumn.key] })}
              onClose={() => setMenu(null)}
            />
          )}
        </Popover>
      </div>
    );
  };

  return (
    <CardShell
      cardKind="scalars"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title={s.title ?? "Scalars"}
      defaultHeight={260}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run", ...columns.map((c) => c.label)];
        const out = rows.map((r) => [labelOf(r.unit), ...columns.map((c) => cellText(c, r.cells[c.key] ?? null))]);
        downloadCsv(headers, out, safeName(s.title ?? "scalars") + ".csv");
      }}
      settingsPanel={<ScalarsSettingsPanel ctl={ctl} mode="card" />}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-[calc(100vh-12rem)] flex-col">{body("flex-1 min-h-0")}</div>}
    >
      {body("flex-1 min-h-0")}
    </CardShell>
  );
}
