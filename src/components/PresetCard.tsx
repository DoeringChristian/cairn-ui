import { useMemo, useRef, useState } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { cardOverridesStorageKey, type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import {
  CONFUSION_LAYOUT,
  PRESET_KIND_LABELS,
  confusionTrace,
  curveLayout,
  curveTraces,
  type CurveKind,
  type Normalize,
  type PresetBlob,
} from "../lib/plot-utils/preset";
import PlotlyChart from "../charts/PlotlyChart";
import {
  useCardSeries,
  useStepSlider,
  resolveAtStep,
  MultiPaneGrid,
} from "./card-kit";
import { useMediaPanes, useScalarMetricNames } from "./card-kit/use-media-panes";
import { formatKeyValue } from "../lib/media/slider-key";
import type { SeriesRef } from "./card-kit/use-card-series";
import AddToComparisonButton from "./AddToComparisonButton";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import PresetSettingsPanel from "./settings-panels/PresetSettingsPanel";
import { instanceDefaults, type PresetSettings } from "./cards-settings/preset";
import StepSlider from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const blobQuery = (hash: string | null | undefined) => ({
  queryKey: ["preset-blob", hash],
  enabled: !!hash,
  staleTime: Infinity,
  // The previous step stays on screen while the next one loads (no placeholder flash).
  placeholderData: keepPreviousData,
  queryFn: async () => {
    const r = await fetch(api.artifactUrl(hash!));
    if (!r.ok) throw new Error(`fetch failed (${r.status})`);
    return (await r.json()) as PresetBlob;
  },
});

function ConfusionPane({ runId, m, targetStep, normalize }: {
  runId: string;
  m: SeriesRef;
  /** The pane's step (per run for a slider key); null: its first point. */
  targetStep: number | null;
  normalize: Normalize;
}) {
  const q = useSequence(m.runId ?? runId, m.name);
  const points = useMemo(() => (q.data?.points ?? []).filter((p) => p.artifact_hash), [q.data]);
  const current = (targetStep == null ? null : resolveAtStep(points, targetStep)) ?? points[0];
  const blob = useQuery(blobQuery(current?.artifact_hash));
  if (q.isLoading || blob.isLoading) return <div className="h-full min-h-32 motion-safe:animate-pulse rounded bg-bg-hover" />;
  if (!blob.data || blob.data.kind !== "confusion_matrix") return <div className="text-sm text-fg-muted">no confusion matrix</div>;
  return <ConfusionChart blob={blob.data} normalize={normalize} />;
}

function ConfusionChart({ blob, normalize }: {
  blob: Extract<PresetBlob, { kind: "confusion_matrix" }>;
  normalize: Normalize;
}) {
  const data = useMemo(() => [confusionTrace(blob.data, normalize)], [blob, normalize]);
  return <PlotlyChart data={data} layout={CONFUSION_LAYOUT} />;
}

/**
 * The `preset` series card: a confusion matrix (heatmap), or PR/ROC curves
 * with the AUC in the legend. Several runs overlay their curves (a color per
 * run, a dash per class) and put confusion matrices side by side.
 */
export default function PresetCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { ctl, effectiveMetrics: allMetrics, allRunIds } =
    useCardSeries<PresetSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: "preset",
      instanceDefaults,
    });
  const settings = ctl.value;
  const { highlight: dropHighlight, dropProps } = useCardDrop(allMetrics, ctl.set);
  // The series shown: hidden runs dropped, pinned first, at most `maxRuns` runs.
  const panes = useMediaPanes(allMetrics, runId, settings.maxRuns);
  const effectiveMetrics = panes.shown;
  const multipleRuns = panes.multiRun;
  const scalarMetrics = useScalarMetricNames(runId);

  const seqQueries = useQueries({
    queries: effectiveMetrics.map((m) => {
      const rid = m.runId ?? runId;
      return {
        queryKey: qk.sequence(rid, m.name),
        queryFn: () => api.sequence(rid, m.name),
        refetchInterval: 2_000,
        staleTime: 2_000,
      };
    }),
  });
  const seriesPoints = useMemo(
    () => seqQueries.map((sq) => ((sq.data as SequenceResponse | undefined)?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seqQueries.map((sq) => sq.dataUpdatedAt).join("|")],
  );

  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds: panes.runIds,
    sync: {
      cardId: cardOverridesStorageKey(settingsKeyOverride ?? { runId, metricName: metric.name }),
      follow: settings.followSection,
    },
  });
  const { values, safeIdx, currentValue, onSliderChange, stepFor, keyName } = slider;

  const currents = useMemo(
    () => seriesPoints.map((pts, i) => {
      const step = stepFor(i, undefined, { nearest: true });
      return (step == null ? null : resolveAtStep(pts, step)) ?? pts[0];
    }),
    [seriesPoints, stepFor],
  );
  const blobs = useQueries({ queries: currents.map((p) => blobQuery(p?.artifact_hash)) });
  const seedMeta = safeJsonParse<{ kind?: PresetBlob["kind"] }>(currents[0]?.artifact_metadata);
  const kind = blobs[0]?.data?.kind ?? seedMeta?.kind;

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const cardRef = useRef<HTMLDivElement>(null);
  const labels = useMemo(
    () => effectiveMetrics.map((m, i) => (multipleRuns ? (panes.labels.get(panes.keys[i]!) ?? m.name) : m.name)),
    [effectiveMetrics, multipleRuns, panes],
  );
  const normalize = settings.normalize;

  const curveData = useMemo(() => {
    if (kind !== "pr_curve" && kind !== "roc_curve") return null;
    const series = blobs.flatMap((b, i) =>
      b.data && b.data.kind === kind
        ? [{ label: labels[i] ?? "", curves: b.data.data.curves, color: panes.colors.get(panes.runIds[i]!) }]
        : []);
    return { traces: curveTraces(kind as CurveKind, series), layout: curveLayout(kind as CurveKind) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, labels, panes, blobs.map((b) => b.dataUpdatedAt).join("|")]);

  const subtitle = [
    kind ? PRESET_KIND_LABELS[kind] : null,
    values.length > 0 ? `${keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${values.length})` : null,
  ].filter(Boolean).join(" · ");

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );
  const paneKeys = panes.keys;
  const paneLabels = panes.labels;

  const renderChart = (inModal: boolean) => {
    if (seqQueries[0]?.isLoading || blobs[0]?.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!currents[0]?.artifact_hash) return <div className="text-sm text-fg-muted">nothing logged yet</div>;
    if (blobs[0]?.isError) return <div className="text-sm text-fg-muted">failed to load</div>;
    if (curveData) return <div className="flex-1 min-h-0"><PlotlyChart data={curveData.traces} layout={curveData.layout} /></div>;
    if (kind !== "confusion_matrix") return <div className="text-sm text-fg-muted">unknown preset</div>;
    if (effectiveMetrics.length === 1) {
      const blob = blobs[0]?.data;
      return blob?.kind === "confusion_matrix"
        ? <div className="flex-1 min-h-0"><ConfusionChart blob={blob} normalize={normalize} /></div>
        : null;
    }
    return (
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        columns={settings.columns}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => ctl.set({ paneWidths: w })}
        renderPane={(key, i) => (
          <ConfusionPane key={key} runId={runId} m={effectiveMetrics[i]!} targetStep={stepFor(i, undefined, { nearest: true })} normalize={normalize} />
        )}
      />
    );
  };

  const renderContent = (inModal: boolean) => (
    <>
      {renderChart(inModal)}
      <StepSlider
        points={slider.sliderPoints}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        keyName={keyName}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => ctl.set({ xAxis: m })}
        className="mt-3"
      />
      {allMetrics.length > 1 && (
        <SeriesChipStrip
          metrics={allMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => ctl.set({ metrics: next })}
        />
      )}
    </>
  );

  const settingsPanel = (
    <PresetSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        confusion: kind === "confusion_matrix",
        multi: effectiveMetrics.length > 1,
        scalarMetrics,
        following: slider.sync != null,
      }}
    />
  );

  return (
    <CardShell
      cardKind="preset"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={340}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      addToComparisonSlot={<AddToComparisonButton cardType="preset" series={compSeries} />}
      addToReportSlot={<AddToReportButton cardType="preset" series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <div className="flex flex-1 min-h-0 flex-col">{renderContent(false)}</div>
    </CardShell>
  );
}
