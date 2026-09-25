import { useMemo, useRef, useState } from "react";
import { useCardSettings } from "../lib/card-settings";
import type { BarSettings } from "./cards-settings/bar";
import BarChart, { type BarDatum } from "../charts/BarChart";
import DistributionChart, { type DistributionGroup } from "../charts/DistributionChart";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { assignRunColors } from "../lib/run-color";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { toNumber, toText } from "../lib/scalar-exprs";
import { groupRuns, summarize } from "../lib/grouping";
import CardShell from "./CardShell";
import BarSettingsPanel from "./settings-panels/BarSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface RunValue {
  id: string;
  label: string;
  value: number;
  group: unknown;
}

export default function BarChartCard({
  runIds: allRunIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();
  const ctl = useCardSettings<BarSettings>(settingsKey, "bar");
  const settings = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const runIds = useVisibleRuns(allRunIds);
  const colorByRun = useRunColors(runIds);

  const metric = settings.metric;
  const groupBy = settings.groupBy;
  const srcs = useMemo(() => [metric?.src ?? "", groupBy?.src ?? ""], [metric, groupBy]);
  const exprs = useScalarExprs(runIds, srcs);

  const runValues = useMemo<RunValue[]>(() => {
    if (!metric) return [];
    const out: RunValue[] = [];
    for (const rid of runIds) {
      const value = toNumber(exprs.values[0]!.get(rid));
      if (value == null) continue;
      out.push({ id: rid, label: shortRunLabel(rid, runIds), value, group: exprs.values[1]!.get(rid) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, runIds, exprs, runMetaVersion]);

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const gs = groupRuns(runValues, (r) => r.group);
    const colors = assignRunColors(gs.map((g) => g.key), () => undefined);
    return gs.map((g) => ({ ...g, color: colors.get(g.key)!, summary: summarize(g.items.map((r) => r.value)) }));
  }, [groupBy, runValues]);

  const desc = settings.sortDesc ?? true;
  const sortRows = <T extends { label: string; value: number }>(rows: T[]): T[] => {
    // Sorting the one metric's bars *is* "sort by value": the degenerate case
    // of sorting categories by their value. Stacked mode ignores the order
    // (segments stack in run order); overlay uses it for z-order.
    const out = [...rows].sort((a, b) =>
      settings.sortBy === "name" ? a.label.localeCompare(b.label, undefined, { numeric: true }) : a.value - b.value,
    );
    return desc ? out.reverse() : out;
  };

  const bars = useMemo<BarDatum[]>(() => {
    if (groups) {
      return sortRows(
        groups.map((g) => ({
          id: g.key,
          label: `${g.label} (${g.items.length})`,
          value: g.summary.mean,
          color: g.color,
          error: g.summary.std,
        })),
      );
    }
    return sortRows(runValues.map((r) => ({ id: r.id, label: r.label, value: r.value, color: colorByRun.get(r.id)! })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, runValues, colorByRun, settings.sortBy, desc]);

  const distGroups = useMemo<DistributionGroup[]>(() => {
    const gs = groups ?? [
      {
        key: "all",
        label: "all runs",
        color: "#1f77b4",
        items: runValues,
        summary: summarize(runValues.map((r) => r.value)),
      },
    ];
    const rows = sortRows(gs.map((g) => ({ g, label: g.label, value: g.summary.median })));
    return rows.map(({ g }) => ({
      key: g.key,
      label: g.label,
      color: g.color,
      values: g.items.map((r) => r.value),
      names: g.items.map((r) => r.label),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, runValues, settings.sortBy, desc]);

  // Stack segment order is intentionally independent of the sort setting
  // ("stacked ... in run order"): the run order, filtered to runs with a value.
  const runOrderIds = useMemo(() => runValues.map((r) => r.id), [runValues]);

  const settingsPanel = (
    <BarSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        options: exprs.options,
        runCount: runIds.length,
        errors: {
          metric: metric ? exprs.errors[0] ?? null : null,
          groupBy: groupBy ? exprs.errors[1] ?? null : null,
        },
      }}
    />
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const distribution = settings.groupPlot !== "bar";
  const valueLabel = metric?.src;
  const message = !metric
    ? "Select a value in settings to create the bar chart."
    : exprs.errors[0]
      ? `Invalid value: ${exprs.errors[0]}`
      : runValues.length === 0
        ? exprs.loading
          ? "Loading…"
          : "No values for this metric across the runs."
        : null;

  const chart = (className: string) =>
    message ? (
      <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>{message}</div>
    ) : distribution ? (
      <DistributionChart
        groups={distGroups}
        kind={settings.groupPlot as "box" | "violin" | "strip"}
        valueLabel={valueLabel}
        log={settings.logX}
        className={className}
      />
    ) : (
      <BarChart
        bars={bars}
        valueLabel={valueLabel}
        logX={settings.logX}
        compareMode={groups ? "grouped" : (settings.compareMode ?? "grouped")}
        runOrder={groups ? bars.map((b) => b.id) : runOrderIds}
        className={className}
      />
    );

  const n = runValues.length;
  const subtitle = groups
    ? `${groups.length} group${groups.length === 1 ? "" : "s"} · ${n} run${n === 1 ? "" : "s"}`
    : `${n} run${n === 1 ? "" : "s"}`;

  return (
    <CardShell cardKind="bar"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title="Bar Chart"
      subtitle={subtitle}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", "label", metric?.src ?? "value"];
        if (groupBy) headers.push(groupBy.src);
        const rows: (string | number)[][] = runValues.map((r) => {
          const row: (string | number)[] = [r.id, r.label, r.value];
          if (groupBy) row.push(toText(r.group) ?? "");
          return row;
        });
        downloadCsv(headers, rows, safeName(settings.title ?? "bar_chart") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "bar_chart")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex flex-col h-[calc(100vh-12rem)]">{chart("flex-1 min-h-0")}</div>}
    >
      {chart("rounded bg-bg flex-1 min-h-0")}
    </CardShell>
  );
}
