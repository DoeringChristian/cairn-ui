import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import type { CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
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
  useRunInfo,
  MultiPaneGrid,
  type BaseCardSettings,
} from "./card-kit";
import type { SeriesRef } from "./card-kit/use-card-series";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Select from "./settings/Select";
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

interface PresetSettings extends BaseCardSettings {
  metrics: SeriesRef[];
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Confusion matrix cells: raw counts, or rows/columns scaled to sum to 1. */
  normalize?: Normalize;
}

const blobQuery = (hash: string | null | undefined) => ({
  queryKey: ["preset-blob", hash],
  enabled: !!hash,
  staleTime: Infinity,
  queryFn: async () => {
    const r = await fetch(api.artifactUrl(hash!));
    if (!r.ok) throw new Error(`fetch failed (${r.status})`);
    return (await r.json()) as PresetBlob;
  },
});

function ConfusionPane({ runId, m, targetStep, normalize }: {
  runId: string;
  m: SeriesRef;
  targetStep: number;
  normalize: Normalize;
}) {
  const q = useSequence(m.runId ?? runId, m.name, { context: m.context_hash || undefined });
  const points = useMemo(() => (q.data?.points ?? []).filter((p) => p.artifact_hash), [q.data]);
  const current = resolveAtStep(points, targetStep) ?? points[0];
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
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<PresetSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (_seed, metrics) => ({ version: 1, metrics }),
    });
  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const seqQueries = useQueries({
    queries: effectiveMetrics.map((m) => {
      const rid = m.runId ?? runId;
      return {
        queryKey: qk.sequence(rid, m.name, m.context_hash),
        queryFn: () => api.sequence(rid, m.name, { context: m.context_hash || undefined }),
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
  const seedPoints = seriesPoints[0] ?? [];

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const currents = useMemo(
    () => seriesPoints.map((pts) => resolveAtStep(pts, currentStep) ?? pts[0]),
    [seriesPoints, currentStep],
  );
  const blobs = useQueries({ queries: currents.map((p) => blobQuery(p?.artifact_hash)) });
  const seedMeta = safeJsonParse<{ kind?: PresetBlob["kind"] }>(currents[0]?.artifact_metadata);
  const kind = blobs[0]?.data?.kind ?? seedMeta?.kind;

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);
  const cardRef = useRef<HTMLDivElement>(null);
  const runMetaVersion = useRunMetadataVersion();
  useRunInfo(allRunIds);

  const labels = useMemo(
    () => effectiveMetrics.map((m) => (multipleRuns ? shortRunLabel(m.runId ?? runId, allRunIds) : m.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, multipleRuns, allRunIds, runId, runMetaVersion],
  );
  const normalize = settings.normalize ?? "none";

  const curveData = useMemo(() => {
    if (kind !== "pr_curve" && kind !== "roc_curve") return null;
    const series = blobs.flatMap((b, i) =>
      b.data && b.data.kind === kind ? [{ label: labels[i] ?? "", curves: b.data.data.curves }] : []);
    return { traces: curveTraces(kind as CurveKind, series), layout: curveLayout(kind as CurveKind) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, labels, blobs.map((b) => b.dataUpdatedAt).join("|")]);

  const subtitle = [
    kind ? PRESET_KIND_LABELS[kind] : null,
    globalSteps.length > 0 ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})` : null,
  ].filter(Boolean).join(" · ");

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );
  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) effectiveMetrics.forEach((m, i) => map.set(seriesKey(m), labels[i] ?? ""));
    return map;
  }, [multipleRuns, effectiveMetrics, labels]);

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
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => (
          <ConfusionPane key={key} runId={runId} m={effectiveMetrics[i]!} targetStep={currentStep} normalize={normalize} />
        )}
      />
    );
  };

  const renderContent = (inModal: boolean) => (
    <>
      {renderChart(inModal)}
      <StepSlider
        points={seedPoints}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      {effectiveMetrics.length > 1 && (
        <SeriesChipStrip
          metrics={effectiveMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => updateSettings({ metrics: next })}
        />
      )}
    </>
  );

  const settingsPanel = kind === "confusion_matrix" ? (
    <Select<Normalize>
      label="Cells"
      value={normalize}
      onChange={(v) => updateSettings({ normalize: v })}
      options={[
        { value: "none", label: "Counts" },
        { value: "true", label: "Normalized by true label (rows)" },
        { value: "pred", label: "Normalized by predicted label (columns)" },
      ]}
    />
  ) : (
    <div className="py-1 text-sm text-fg-muted">No settings for curves.</div>
  );

  return (
    <CardShell
      cardKind="preset"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={340}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      addToComparisonSlot={<AddToComparisonButton cardType="preset" series={compSeries} />}
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
