/**
 * Run comparer card: the card's runs side by side, one column per run —
 * final metric values (best green, worst red; rule-aware), params and the
 * captured environment. Rows that are the same everywhere can be hidden;
 * pinned keys always show first.
 */

import { useMemo, useRef, useState } from "react";
import { useRunsDetails } from "../api/hooks";
import type { RunDetailResponse } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { buildEnvDiff, buildMetricsSummary, buildParamDiff, selectRows, type CompareTable } from "../lib/run-compare";
import { disambiguateRunLabels, shortRunId, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import type { FieldOption } from "./settings/palette";
import { HeaderToggle } from "./card-header";
import type { RunCompareSection, RunCompareSettings } from "./cards-settings/run-compare";
import EnvDiffTable from "./run-compare/EnvDiffTable";
import MetricsSummaryTable from "./run-compare/MetricsSummaryTable";
import ParamsDiffTable from "./run-compare/ParamsDiffTable";
import type { RunCompareSectionProps } from "./run-compare/CompareRowsTable";
import CardShell from "./CardShell";
import RunCompareSettingsPanel from "./settings-panels/RunCompareSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const TABLES: Record<RunCompareSection, (p: RunCompareSectionProps) => JSX.Element> = {
  metrics: MetricsSummaryTable,
  params: ParamsDiffTable,
  env: EnvDiffTable,
};

const BUILD: Record<RunCompareSection, (runs: readonly RunDetailResponse[]) => CompareTable> = {
  metrics: buildMetricsSummary,
  params: buildParamDiff,
  env: buildEnvDiff,
};

export default function RunCompareCard({ runIds: allRunIds, settingsKey, onRemove, autoOpenSettings }: Props) {
  const ctl = useCardSettings<RunCompareSettings>(settingsKey, "run-compare");
  const s = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const runIds = useVisibleRuns(allRunIds);
  const colors = useRunColors(allRunIds);

  const queries = useRunsDetails(runIds);
  const loading = queries.some((q) => q.isLoading);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const runs = useMemo(
    () => queries.map((q) => q.data).filter((d): d is RunDetailResponse => d != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, runIds.join("|")],
  );

  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(runIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), metaVersion],
  );

  const pinKeys = useMemo<FieldOption[]>(() => {
    const out: FieldOption[] = [];
    for (const k of buildMetricsSummary(runs).rows) out.push({ key: k.key, kind: "metric", label: k.key });
    for (const k of buildParamDiff(runs).rows) out.push({ key: k.key, kind: "param", label: k.key });
    return out;
  }, [runs]);

  const togglePin = (key: string) =>
    ctl.set({ pinnedKeys: s.pinnedKeys.includes(key) ? s.pinnedKeys.filter((k) => k !== key) : [...s.pinnedKeys, key] });

  const settingsPanel = <RunCompareSettingsPanel ctl={ctl} mode="card" ctx={{ keys: pinKeys }} />;
  const cardRef = useRef<HTMLDivElement>(null);

  const body = (className: string) => {
    if (runIds.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>No runs to compare.</p>;
    if (loading && runs.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>Loading run details…</p>;
    if (s.sections.length === 0) return <p className={`text-sm text-fg-muted ${className}`}>Pick a table in settings.</p>;
    return (
      <div className={`flex flex-col gap-5 overflow-auto ${className}`}>
        {s.sections.map((sec) => {
          const Table = TABLES[sec];
          return (
            <Table
              key={sec}
              runs={runs}
              labels={labels}
              colors={colors}
              onlyDiffs={s.onlyDiffs}
              filter={s.filter}
              pinnedKeys={s.pinnedKeys}
              onTogglePin={ctl.locked ? undefined : togglePin}
            />
          );
        })}
      </div>
    );
  };

  return (
    <CardShell
      cardKind="run-compare"
      cardRef={cardRef}
      settings={s}
      updateSettings={ctl.set}
      title="Run Comparer"
      subtitle={`${runIds.length} run${runIds.length === 1 ? "" : "s"}`}
      defaultHeight={420}
      headerActions={
        <HeaderToggle
          icon="fa-not-equal"
          label="Only differences"
          pressed={s.onlyDiffs}
          onToggle={() => ctl.set({ onlyDiffs: !s.onlyDiffs })}
          disabled={ctl.locked}
        />
      }
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["table", "key", ...runs.map((rd) => labels[rd.run.id] ?? shortRunId(rd.run.id))];
        const rows: (string | number)[][] = [];
        for (const sec of s.sections) {
          for (const r of selectRows(BUILD[sec](runs), s)) {
            rows.push([sec, r.key, ...r.values.map((v) => (v == null ? "" : typeof v === "number" ? v : String(v)))]);
          }
        }
        downloadCsv(headers, rows, safeName(s.title ?? "run_comparer") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(s.title ?? "run_comparer")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex flex-col h-[calc(100vh-12rem)]">{body("flex-1 min-h-0")}</div>}
    >
      {body("flex-1 min-h-0")}
    </CardShell>
  );
}
