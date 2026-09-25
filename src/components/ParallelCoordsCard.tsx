/**
 * Parallel Coordinates card for hyperparameter comparison.
 *
 * Each column is a scalar expression per run (`config.lr`, `min(val.loss)`,
 * `last(acc) - first(acc)`, …); reducers over metrics come from the runs'
 * stats, so no sequence is fetched unless a column needs one. Each polyline
 * is a run. Lines are coloured by the rightmost column's value.
 */

import { useMemo, useRef, useState } from "react";
import ParallelChart, { type ParallelRow } from "../charts/ParallelChart";
import { useCardSettings } from "../lib/card-settings";
import { instanceDefaults, type ParallelSettings } from "./cards-settings/parallel";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { useVisibleRuns } from "../lib/run-view";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { toNumber, toText } from "../lib/scalar-exprs";
import CardShell from "./CardShell";
import ParallelSettingsPanel from "./settings-panels/ParallelSettingsPanel";

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
  /** Settings a fresh card starts from (e.g. a sweep's params and metric). */
  defaults?: Partial<ParallelSettings>;
}

export default function ParallelCoordsCard({
  runIds: allRunIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
  defaults,
}: Props) {
  const ctl = useCardSettings<ParallelSettings>(settingsKey, "parallel", instanceDefaults(defaults));
  const settings = ctl.value;
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const runIds = useVisibleRuns(allRunIds);

  const srcs = useMemo(() => settings.columns.map((c) => c.src), [settings.columns]);
  const exprs = useScalarExprs(runIds, srcs);

  const rowData = useMemo<ParallelRow[]>(() => {
    if (srcs.length === 0) return [];
    return runIds
      .filter((rid) => exprs.details.has(rid))
      .map((rid) => ({
        id: rid,
        values: exprs.values.map((m) => toNumber(m.get(rid))),
        raw: exprs.values.map((m) => toText(m.get(rid))),
      }));
  }, [runIds, srcs, exprs]);

  const settingsPanel = (
    <ParallelSettingsPanel ctl={ctl} mode="card" ctx={{ options: exprs.options, errors: exprs.errors }} />
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const noColumns = settings.columns.length === 0;
  const plotProps = { columns: settings.columns, rows: rowData };
  const empty = (className: string) => (
    <div className={`flex items-center justify-center text-sm text-fg-muted ${className}`}>
      Add columns in settings to build the parallel coordinates plot.
    </div>
  );

  return (
    <CardShell cardKind="parallel"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title="Parallel Coordinates"
      subtitle={`${runIds.length} runs · ${settings.columns.length} columns`}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", ...settings.columns.map((c) => c.src)];
        const rows: (string | number)[][] = rowData.map((row) => [row.id, ...row.raw.map((v) => v ?? "")]);
        downloadCsv(headers, rows, safeName(settings.title ?? "parallel_coords") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "parallel_coords")); }}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          {noColumns ? empty("flex-1") : <ParallelChart {...plotProps} className="flex-1 min-h-0" />}
        </div>
      }
    >
      {noColumns ? empty("flex-1 min-h-0") : <ParallelChart {...plotProps} className="rounded bg-bg flex-1 min-h-0" />}
    </CardShell>
  );
}
