import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { formatNum } from "../lib/plot-utils/types";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import { cardOverridesStorageKey, useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { TensorSettings, TensorViewMode as ViewMode } from "./cards-settings/tensor";
import type { SequenceMeta } from "../api/types";
import { computeHistogram } from "../lib/plot-utils/histogram";
import {
  HistogramBars,
  MatrixHeatmap,
} from "../charts/HistogramChart";
import { parseNpy, type NpyArray } from "../lib/parse-npy";
import AddToComparisonButton from "./AddToComparisonButton";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import { useStepSlider, resolveAtStep } from "./card-kit";
import { useScalarMetricNames } from "./card-kit/use-media-panes";
import TensorSettingsPanel from "./settings-panels/TensorSettingsPanel";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface TensorMeta {
  shape: number[];
  dtype: string;
  min: number;
  max: number;
  mean: number;
  size_bytes: number;
}


const SIZE_CAP = 10 * 1024 * 1024;

/** C- or Fortran-order strides for a shape. */
function strides(shape: number[], fortran: boolean): number[] {
  const n = shape.length;
  const st = new Array<number>(n).fill(1);
  if (fortran) {
    for (let k = 1; k < n; k++) st[k] = st[k - 1]! * shape[k - 1]!;
  } else {
    for (let k = n - 2; k >= 0; k--) st[k] = st[k + 1]! * shape[k + 1]!;
  }
  return st;
}

/** Extract the trailing 2D slice `[rows, cols]` at the given leading indices. */
function sliceMatrix(
  data: Float64Array,
  shape: number[],
  fortran: boolean,
  leading: number[],
): number[][] {
  const n = shape.length;
  const rows = shape[n - 2]!;
  const cols = shape[n - 1]!;
  const st = strides(shape, fortran);
  let base = 0;
  for (let k = 0; k < n - 2; k++) {
    const idx = Math.max(0, Math.min(shape[k]! - 1, leading[k] ?? 0));
    base += idx * st[k]!;
  }
  const rs = st[n - 2]!;
  const cs = st[n - 1]!;
  const m: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = data[base + r * rs + c * cs]!;
    m.push(row);
  }
  return m;
}

async function fetchNpy(hash: string): Promise<NpyArray> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseNpy(await res.arrayBuffer());
}

export default function TensorCard({
  runId,
  metric,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const q = useSequence(runId, metric.name);
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  const settingsKey = useMemo(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
      },
    [settingsKeyOverride, runId, metric.name],
  );
  const ctl = useCardSettings<TensorSettings>(settingsKey, "tensor");
  const settings = ctl.value;

  const seriesPoints = useMemo(() => [points], [points]);
  const seriesRunIds = useMemo(() => [runId], [runId]);
  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds,
    sync: { cardId: cardOverridesStorageKey(settingsKey), follow: settings.followSection },
  });
  const { safeIdx, currentStep, onSliderChange } = slider;
  const scalarMetrics = useScalarMetricNames(runId);
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );
  const meta = useMemo(
    () => safeJsonParse<TensorMeta>(current?.artifact_metadata),
    [current],
  );

  const shape = meta?.shape ?? [];
  const ndim = shape.length;
  const tooBig = (meta?.size_bytes ?? 0) > SIZE_CAP;

  // Resolve the effective view: fall back to stats for oversized blobs and to
  // histogram when a heatmap is requested for a < 2D tensor.
  let effectiveView: ViewMode = settings.viewMode;
  if (tooBig) effectiveView = "stats";
  else if (effectiveView === "heatmap" && ndim < 2) effectiveView = "histogram";

  const needsBlob = effectiveView !== "stats";
  const npyQuery = useQuery({
    queryKey: ["cairn-npy", current?.artifact_hash],
    queryFn: () => fetchNpy(current!.artifact_hash!),
    enabled: !!current?.artifact_hash && needsBlob,
    staleTime: Infinity,
  });
  const arr = npyQuery.data;

  const histogram = useMemo(() => {
    if (effectiveView !== "histogram" || !arr) return null;
    return computeHistogram(arr.data, settings.bins);
  }, [effectiveView, arr, settings.bins]);

  const leadingDims = ndim > 2 ? shape.slice(0, ndim - 2) : [];
  const matrix = useMemo(() => {
    if (effectiveView !== "heatmap" || !arr || arr.shape.length < 2) return null;
    return sliceMatrix(
      arr.data,
      arr.shape,
      arr.fortranOrder,
      settings.sliceIndices ?? [],
    );
  }, [effectiveView, arr, settings.sliceIndices]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );

  const shapeLabel = ndim > 0 ? shape.join("×") : "scalar";
  const subtitle =
    points.length > 0
      ? `${shapeLabel} · ${meta?.dtype ?? "?"} · step ${current?.step ?? "—"} (${safeIdx + 1}/${slider.values.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const statsGrid = meta && (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
      <span>shape</span>
      <span className="mono num">{shapeLabel}</span>
      <span>dtype</span>
      <span className="mono num">{meta.dtype}</span>
      <span>min</span>
      <span className="mono num">{formatNum(meta.min)}</span>
      <span>max</span>
      <span className="mono num">{formatNum(meta.max)}</span>
      <span>mean</span>
      <span className="mono num">{formatNum(meta.mean)}</span>
      <span>size</span>
      <span className="mono num">{meta.size_bytes} B</span>
    </div>
  );

  const renderBody = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash || !meta) {
      return <div className="text-sm text-fg-muted">no tensor logged yet</div>;
    }

    if (effectiveView === "stats") {
      return (
        <div className="flex-1 min-h-0 overflow-auto">
          {statsGrid}
          {tooBig && (
            <p className="mt-2 text-xs text-fg-subtle">
              Blob exceeds 10MB — showing stats only.
            </p>
          )}
        </div>
      );
    }

    if (npyQuery.isLoading) {
      return <div className="flex-1 min-h-0 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (npyQuery.isError || !arr) {
      return (
        <div className="flex-1 min-h-0 text-xs text-fg-muted">
          could not read tensor blob
        </div>
      );
    }

    if (effectiveView === "histogram") {
      return (
        <div className="flex-1 min-h-0">
          {histogram && (
            <HistogramBars
              counts={histogram.counts}
              edges={histogram.edges}
              logY={settings.logY}
            />
          )}
        </div>
      );
    }

    // heatmap
    return (
      <div className="flex-1 min-h-0">
        {matrix ? (
          <MatrixHeatmap
            matrix={matrix}
            colormap={settings.colormap}
            min={meta.min}
            max={meta.max}
            logColor={settings.logY}
            xLabel={`dim ${ndim - 1}`}
            yLabel={`dim ${ndim - 2}`}
          />
        ) : (
          <div className="text-xs text-fg-muted">tensor is not 2D</div>
        )}
      </div>
    );
  };

  const renderContent = () => (
    <>
      {renderBody()}
      {slider.values.length > 1 && (
        <StepSlider
          points={slider.sliderPoints}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          keyName={slider.keyName}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => ctl.set({ xAxis: m })}
          className="mt-3"
        />
      )}
    </>
  );

  const settingsPanel = (
    <TensorSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        leadingDims,
        below2d: ndim < 2,
        stats: statsGrid,
        scalarMetrics,
        following: slider.sync != null,
      }}
    />
  );

  return (
    <CardShell cardKind="tensor"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={300}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npy"),
              )
          : undefined
      }
      addToComparisonSlot={
        <AddToComparisonButton cardType="tensor" series={compSeries} />
      }
      addToReportSlot={<AddToReportButton cardType="tensor" series={compSeries} settingsKey={settingsKey} />}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent()}</>
    </CardShell>
  );
}
