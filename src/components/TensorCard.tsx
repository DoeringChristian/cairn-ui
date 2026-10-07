import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import { cardOverridesStorageKey, useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { TensorSettings } from "./cards-settings/tensor";
import type { SequenceMeta } from "../api/types";
import GalleryView from "./media/GalleryView";
import { isGalleryPoint } from "../lib/media/gallery";
import { galleryQuery } from "../lib/media/gallery-query";
import { StatsGrid, TensorView, npyQueryOf, tensorFacts, type TensorMeta } from "./viewers/TensorViewer";
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
  const ownSeries = useMemo(() => [{ runId, name: metric.name }], [runId, metric.name]);
  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds,
    series: ownSeries,
    sync: { cardId: cardOverridesStorageKey(settingsKey), follow: settings.followSection },
  });
  const { safeIdx, currentStep, onSliderChange } = slider;
  const scalarMetrics = useScalarMetricNames(runId);
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );
  const qc = useQueryClient();
  // A gallery's facts (shape, stats) for the subtitle and settings come from its first item.
  const gallery = isGalleryPoint(current);
  const galleryItems = useQuery({ ...galleryQuery(current?.artifact_hash ?? ""), enabled: gallery });
  const meta = useMemo(
    () => (gallery
      ? (galleryItems.data?.[0]?.metadata ?? null) as TensorMeta | null
      : safeJsonParse<TensorMeta>(current?.artifact_metadata)),
    [gallery, galleryItems.data, current],
  );
  const { ndim, shapeLabel, leadingDims } = tensorFacts(meta, settings);
  const statsGrid = meta && <StatsGrid meta={meta} shapeLabel={shapeLabel} />;

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);


  const subtitle =
    points.length > 0
      ? `${gallery ? `${galleryItems.data?.length ?? "…"} × ` : ""}${shapeLabel} · ${meta?.dtype ?? "?"} · ${slider.summary ? "summary" : `step ${current?.step ?? "—"} (${safeIdx + 1}/${slider.values.length})`}`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const renderBody = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no tensor logged yet</div>;
    }
    if (gallery) {
      return (
        <div className="flex-1 min-h-0 overflow-auto">
          <GalleryView
            point={current}
            fill
            minItemHeight={150}
            prefetchItem={(p) => qc.prefetchQuery(npyQueryOf(p.artifact_hash!))}
            peekItem={(p) => settings.viewMode === "stats" || qc.getQueryData(npyQueryOf(p.artifact_hash!).queryKey) !== undefined}
            renderItem={(item) => <TensorView hash={item.artifact_hash!} meta={safeJsonParse<TensorMeta>(item.artifact_metadata)} settings={settings} />}
          />
        </div>
      );
    }
    return <TensorView hash={current.artifact_hash} meta={meta} settings={settings} />;
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
        // A gallery: its items (marked by GalleryView), zipped.
        current?.artifact_hash && !gallery
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npy"),
              )
          : undefined
      }
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
