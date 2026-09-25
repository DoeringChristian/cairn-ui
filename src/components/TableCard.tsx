import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequencesForRuns } from "../api/hooks";
import { api } from "../api/client";
import { downloadCsv, safeName } from "../lib/download";
import { type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunColors, useVisibleRuns } from "../lib/run-view";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid } from "./card-kit";
import { instanceDefaults, type TableCombineSource, type TableSettings } from "./cards-settings/table";
import AddToComparisonButton from "./AddToComparisonButton";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import StepSlider from "./StepSlider";
import { computeTableDiff, type CellComparison } from "../lib/table-diff";
import { cellText, type TableData } from "../lib/table/types";
import { applyTableOps, type TableOpsResult } from "../lib/table/pipeline";
import { concatTables, defaultJoinKey, joinTables, suffixedPairs } from "../lib/table/combine";
import { alignReference } from "../lib/table/text-diff";
import DataTable from "./table/DataTable";
import QueryBar from "./table/QueryBar";
import TableSettingsPanel, { type TablePanelCtx } from "./settings-panels/TableSettingsPanel";

// The grid is intentionally hand-rolled — no grid dependency.

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface Series {
  runId: string;
  name: string;
}

const skey = (s: Series) => `${s.runId}::${s.name}`;

/**
 * The parsed `table` blobs of `hashes`, cached by artifact hash (immutable
 * content, so never stale).
 */
function useTableBlobs(hashes: Array<string | null | undefined>) {
  return useQueries({
    queries: hashes.map((hash) => ({
      queryKey: ["table-blob", hash],
      enabled: !!hash,
      staleTime: Infinity,
      queryFn: async () => {
        const r = await fetch(api.artifactUrl(hash!));
        if (!r.ok) throw new Error(`fetch failed (${r.status})`);
        return (await r.json()) as TableData;
      },
    })),
  });
}

/** CSV-friendly cell (string | number) for downloadCsv; a media cell is its hash. */
function csvCell(v: unknown): string | number {
  if (typeof v === "number") return v;
  return cellText(v);
}

const SKELETON = <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;

/** A table before the card's operations: loading, missing, failed, or loaded. */
type Raw =
  | { status: "loading" }
  | { status: "empty" | "error"; message: string }
  | { status: "ok"; table: TableData };

/** A table as shown: the raw states, or the operations' result. */
type Shown = Exclude<Raw, { status: "ok" }> | { status: "ok"; table: TableData; result: TableOpsResult };

function PaneLabel({ label, color }: { label: string; color?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
      {color && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="mono truncate" title={label}>{label}</span>
    </div>
  );
}

export default function TableCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { ctl, effectiveMetrics, allRunIds, multipleRuns } = useCardSeries<TableSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    type: "table",
    instanceDefaults,
  });
  const settings = ctl.value;
  const { ops, combine } = settings;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, ctl.set);

  useRunInfo(allRunIds);
  const runMetaVersion = useRunMetadataVersion();
  const visibleRunIds = useVisibleRuns(allRunIds);
  const runColors = useRunColors(allRunIds);

  // The card's series, minus hidden runs.
  const series = useMemo<Series[]>(() => {
    const visible = new Set(visibleRunIds);
    return effectiveMetrics
      .map((m) => ({ runId: m.runId ?? runId, name: m.name }))
      .filter((s) => visible.has(s.runId));
  }, [effectiveMetrics, visibleRunIds, runId]);

  const severalNames = useMemo(() => new Set(effectiveMetrics.map((m) => m.name)).size > 1, [effectiveMetrics]);
  const labelOf = useMemo(
    () => (s: Series) => {
      if (!multipleRuns) return s.name;
      const run = shortRunLabel(s.runId, allRunIds);
      return severalNames ? `${run} · ${s.name}` : run;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multipleRuns, allRunIds, severalNames, runMetaVersion],
  );

  // Combine sources (none set = every series at the slider's step).
  const combineSources = useMemo<TableCombineSource[]>(() => {
    if (combine.mode === "none") return [];
    const all = combine.sources.length > 0 ? combine.sources : series.map((s) => ({ ...s, step: "slider" as const }));
    return combine.mode === "join" ? all.slice(0, 2) : all;
  }, [combine.mode, combine.sources, series]);

  // Sequences of every series and source (cache shared with other cards).
  const specs = useMemo(() => {
    const seen = new Set<string>();
    const out: Series[] = [];
    for (const s of [...series, ...combineSources]) {
      const k = skey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ runId: s.runId, name: s.name });
    }
    return out;
  }, [series, combineSources]);
  const seqQueries = useSequencesForRuns(specs);
  const seqKey = seqQueries.map((q) => q.dataUpdatedAt).join("|");
  const pointsByKey = useMemo(() => {
    const map = new Map<string, SequencePoint[]>();
    specs.forEach((s, i) => {
      const pts = seqQueries[i]?.data?.points ?? [];
      map.set(skey(s), pts.filter((p) => p.artifact_hash));
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, seqKey]);
  const seqLoading = seqQueries.some((q) => q.isLoading);

  const seriesPoints = useMemo(() => series.map((s) => pointsByKey.get(skey(s)) ?? []), [series, pointsByKey]);
  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
  });
  const sliderPoints = seriesPoints.find((p) => p.length > 0) ?? [];

  // What to fetch: one table per pane, or one per combine source (a fixed
  // step resolves as-of that step; the slider's also falls forward to a
  // run's first table).
  const fetchList = useMemo(() => {
    const list: TableCombineSource[] =
      combine.mode === "none" ? series.map((s) => ({ ...s, step: "slider" })) : combineSources;
    return list.map((s) => {
      const step = s.step === "slider" ? currentStep : s.step;
      const point = resolveAtStep(pointsByKey.get(skey(s)) ?? [], step, { nearest: s.step === "slider" });
      const label = labelOf(s) + (s.step === "slider" ? "" : ` @ ${s.step}`);
      return { series: s, step, hash: point?.artifact_hash ?? null, label, color: runColors.get(s.runId) };
    });
  }, [combine.mode, series, combineSources, currentStep, pointsByKey, labelOf, runColors]);
  const blobQueries = useTableBlobs(fetchList.map((f) => f.hash));
  const blobKey = blobQueries.map((q) => `${q.dataUpdatedAt}:${q.status}`).join("|");

  // Tables before the operations: one per pane, or the combined one.
  const raw = useMemo<Raw[]>(() => {
    const one = (i: number): Raw => {
      const f = fetchList[i]!;
      const q = blobQueries[i];
      if (!f.hash) {
        return seqLoading
          ? { status: "loading" }
          : { status: "empty", message: `no table logged${combine.mode === "none" ? "" : ` for ${f.label}`} at step ${f.step}` };
      }
      if (!q || q.isLoading) return { status: "loading" };
      if (q.isError || !q.data) return { status: "error", message: "failed to load table" };
      return { status: "ok", table: q.data };
    };
    const parts = fetchList.map((_, i) => one(i));
    if (combine.mode === "none") return parts;
    const notOk = parts.find((p) => p.status === "loading") ?? parts.find((p) => p.status !== "ok");
    if (notOk) return [notOk];
    const tables = parts.map((p) => (p as Extract<Raw, { status: "ok" }>).table);
    if (tables.length === 0) return [{ status: "empty", message: "no sources" }];
    if (combine.mode === "join" && tables.length < 2) return [{ status: "empty", message: "a join needs two sources" }];
    try {
      const table =
        combine.mode === "concat"
          ? concatTables(tables, { labels: fetchList.map((f) => f.label) })
          : joinTables(tables[0]!, tables[1]!, { on: combine.on, how: combine.how });
      return [{ status: "ok", table }];
    } catch (e) {
      return [{ status: "error", message: e instanceof Error ? e.message : String(e) }];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combine.mode, combine.on, combine.how, fetchList, blobKey, seqLoading]);

  const shown = useMemo<Shown[]>(
    () => raw.map((r) => (r.status === "ok" ? { ...r, result: applyTableOps(r.table, ops) } : r)),
    [raw, ops],
  );

  const isMulti = combine.mode === "none" && series.length > 1;
  const firstOk = shown.find((l): l is Extract<Shown, { status: "ok" }> => l.status === "ok");
  const first = firstOk?.result;

  // Red/green numeric diff across panes.
  const diffDefault = series.length === 2;
  const diffEnabled = isMulti && (settings.diffMode ?? diffDefault);
  const invertDiffColors = settings.invertDiffColors ?? false;
  const paneDiffStatuses = useMemo<Array<CellComparison[][] | undefined>>(() => {
    if (!diffEnabled) return [];
    const entries = shown.flatMap((l, i) => (l.status === "ok" ? [{ i, table: l.result.table }] : []));
    if (entries.length < 2) return [];
    const result = computeTableDiff(entries.map((e) => e.table));
    const byPane: Array<CellComparison[][] | undefined> = new Array(shown.length).fill(undefined);
    entries.forEach((e, idx) => {
      byPane[e.i] = result[idx];
    });
    return byPane;
  }, [diffEnabled, shown]);

  // Text diffs: each pane against the first; a join's x_2 against x_1.
  const paneTextRefs = useMemo<Array<unknown[][] | undefined>>(() => {
    if (settings.textDiff === "off") return [];
    const head = shown[0];
    if (head?.status !== "ok") return [];
    if (combine.mode === "join") {
      const t = head.result.table;
      const pairs = suffixedPairs(t);
      if (pairs.length === 0) return [];
      return [
        t.data.map((row) => {
          const refs: unknown[] = new Array(t.columns.length).fill(undefined);
          for (const [li, ri] of pairs) refs[ri] = row[li];
          return refs;
        }),
      ];
    }
    if (!isMulti) return [];
    const ref = head.result.table;
    return shown.map((l, i) => (i === 0 || l.status !== "ok" ? undefined : alignReference(ref, l.result.table)));
  }, [settings.textDiff, combine.mode, isMulti, shown]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const cardRef = useRef<HTMLDivElement>(null);

  const compSeries = useMemo(() => [{ runId, name: metric.name }], [runId, metric.name]);

  const subtitle = useMemo(() => {
    const dims = first ? `${first.table.data.length}×${first.table.columns.length}` : `${metric.count} pts`;
    if (globalSteps.length > 0) {
      return `${dims} · step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`;
    }
    return dims;
  }, [first, metric.count, globalSteps.length, currentStep, safeIdx]);

  const downloadCurrentCsv = () => {
    if (!first) return;
    const table = first.table;
    downloadCsv(
      table.columns.map((c) => c.name),
      table.data.map((row) => row.map(csvCell)),
      `${safeName(metric.name)}_step${currentStep}.csv`,
    );
  };

  // Row counts for the query bar (before group-by), across panes.
  const rowCounts = useMemo(() => {
    let total = 0;
    let after = 0;
    for (const l of shown) {
      if (l.status !== "ok") continue;
      total += l.table.data.length;
      after += l.result.queriedRows;
    }
    return { total, after };
  }, [shown]);

  // Settings panel context.
  const panelCtx = useMemo<TablePanelCtx>(() => {
    const derivedOk = (ops.derived ?? [])
      .filter((_, i) => first?.derivedErrors[i] === null)
      .map((d) => d.name.trim());
    const baseCols = firstOk?.table.columns.map((c) => c.name) ?? [];
    const joinParts = combine.mode === "join" ? blobQueries.slice(0, 2).map((q) => q.data) : [];
    return {
      inputColumns: [...baseCols, ...derivedOk.filter((d) => !baseCols.includes(d))],
      derivedColumns: derivedOk,
      outputColumns: first?.table.columns.map((c) => c.name) ?? [],
      multi: isMulti,
      diffDefault,
      sources: series.map((s) => ({
        runId: s.runId,
        name: s.name,
        label: labelOf(s),
        color: runColors.get(s.runId),
        steps: (pointsByKey.get(skey(s)) ?? []).map((p) => p.step),
      })),
      derivedErrors: first?.derivedErrors,
      groupByError: first?.groupByError,
      autoJoinKey: joinParts[0] && joinParts[1] ? defaultJoinKey(joinParts[0], joinParts[1]) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.derived, first, firstOk, combine.mode, blobKey, isMulti, diffDefault, series, labelOf, runColors, pointsByKey]);

  const renderTable = (l: Shown | undefined, i: number) => {
    if (!l || l.status === "loading") return SKELETON;
    if (l.status !== "ok") return <div className="text-sm text-fg-muted">{l.message}</div>;
    return (
      <DataTable
        table={l.result.table}
        rowsPerPage={settings.rowsPerPage}
        hiddenColumns={settings.hiddenColumns}
        diffStatuses={paneDiffStatuses[i]}
        invertDiff={invertDiffColors}
        textRefs={paneTextRefs[i]}
        textDiffMode={settings.textDiff === "off" ? undefined : settings.textDiff}
      />
    );
  };

  const opsError = first?.groupByError
    ? `group by: ${first.groupByError}`
    : first?.derivedErrors.some((e) => e !== null)
      ? "a derived column has an error (see Expressions in settings)"
      : null;

  const header = (
    <>
      <QueryBar
        value={ops.query ?? ""}
        onChange={(query) => ctl.set({ ops: { ...ops, query: query || undefined } })}
        error={first?.queryError}
        shown={rowCounts.after}
        total={rowCounts.total}
        columns={panelCtx.inputColumns}
      />
      {opsError && <div className="mono mb-1 truncate text-[11px] text-status-failed" title={opsError}>{opsError}</div>}
    </>
  );

  const slider = (
    <StepSlider
      points={sliderPoints}
      currentIndex={safeIdx}
      onChange={onSliderChange}
      xAxis={settings.xAxis}
      onXAxisChange={(m) => ctl.set({ xAxis: m })}
      className="mt-3"
    />
  );

  const renderContent = (inModal: boolean) => {
    if (series.length === 0 && combine.mode === "none") {
      return <div className="text-sm text-fg-muted">every run of this card is hidden</div>;
    }
    if (!isMulti) {
      const legend = combine.mode !== "none" && (
        <div className="flex flex-wrap gap-x-3">
          {fetchList.map((f, i) => (
            <PaneLabel
              key={i}
              color={f.color}
              label={combine.mode === "join" ? `_${i + 1}: ${f.label}` : f.label}
            />
          ))}
        </div>
      );
      return (
        <>
          {header}
          {legend}
          <div className="flex-1 min-h-0">{renderTable(shown[0], 0)}</div>
          {slider}
        </>
      );
    }
    return (
      <>
        {header}
        <MultiPaneGrid
          paneKeys={fetchList.map((f) => skey(f.series))}
          labels={new Map()}
          inModal={inModal}
          paneWidths={settings.paneWidths}
          onPaneWidthsChange={(w) => ctl.set({ paneWidths: w })}
          renderPane={(key, i) => (
            <div key={key} className="flex h-full min-h-0 flex-col">
              <PaneLabel label={fetchList[i]!.label} color={fetchList[i]!.color} />
              <div className="flex-1 min-h-0">{renderTable(shown[i], i)}</div>
            </div>
          )}
        />
        {slider}
        <SeriesChipStrip
          metrics={effectiveMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => ctl.set({ metrics: next })}
        />
      </>
    );
  };

  return (
    <CardShell
      cardKind="table"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={320}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={first ? downloadCurrentCsv : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="table" series={compSeries} />}
      addToReportSlot={<AddToReportButton cardType="table" series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={<TableSettingsPanel ctl={ctl} ctx={panelCtx} mode="card" />}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent(false)}</>
    </CardShell>
  );
}
