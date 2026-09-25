import { useMemo, useRef, useState } from "react";
import { useSequencesForRuns } from "../api/hooks";
import { api } from "../api/client";
import type { SequencePoint } from "../api/types";
import { cardOverridesStorageKey } from "../lib/card-settings";
import { safeJsonParse } from "../lib/format";
import { artifactFilename } from "../lib/download";
import { formatKeyValue } from "../lib/media/slider-key";
import { useCardDrop } from "../lib/use-series-drop";
import { useCardSeries, useStepSlider, resolveAtStep, MultiPaneGrid } from "./card-kit";
import { useMediaPanes, useScalarMetricNames } from "./card-kit/use-media-panes";
import { instanceDefaults, type VolumeSettings } from "./cards-settings/volume";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import UnsupportedArtifact from "./UnsupportedArtifact";
import VolumeSettingsPanel from "./settings-panels/VolumeSettingsPanel";
import type { Scene3DCardProps } from "./viewer3d/Scene3DCard";

interface VolumeMeta {
  shape: [number, number, number];
  dtype: string;
  vmin: number;
  vmax: number;
}

function VolumePane({ name, points, targetStep }: { name: string; points: SequencePoint[]; targetStep: number | null }) {
  const current = targetStep == null ? null : resolveAtStep(points, targetStep);
  if (!current?.artifact_hash) {
    return <div className="flex h-full items-center justify-center text-sm text-fg-muted">no volume logged yet</div>;
  }
  const meta = safeJsonParse<VolumeMeta>(current.artifact_metadata);
  const detail = meta
    ? `${meta.shape.join("×")} · ${meta.dtype} · [${meta.vmin.toPrecision(3)}, ${meta.vmax.toPrecision(3)}]`
    : undefined;
  return (
    <UnsupportedArtifact
      label="Volume — not viewable in the browser"
      detail={detail}
      downloadUrl={api.artifactUrl(current.artifact_hash)}
      filename={artifactFilename(name, current.step, current.artifact_mime, ".npz")}
    />
  );
}

/** Volumes aren't rendered: one placeholder pane per run with the step's `.npz` to download. */
export default function VolumeCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Scene3DCardProps) {
  const { ctl, effectiveMetrics: allMetrics } =
    useCardSeries<VolumeSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: "volume",
      instanceDefaults,
    });
  const settings = ctl.value;
  const { highlight: dropHighlight, dropProps } = useCardDrop(allMetrics, ctl.set);
  const panes = useMediaPanes(allMetrics, runId, settings.maxRuns);
  const scalarMetrics = useScalarMetricNames(runId);

  const queries = useSequencesForRuns(
    panes.shown.map((m, i) => ({ runId: panes.runIds[i]!, name: m.name })),
  );
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join(","), panes.shown.length],
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

  const [settingsOpen, setSettingsOpen] = useState(autoOpenSettings ?? false);
  const cardRef = useRef<HTMLDivElement>(null);

  const body = (
    <div className="mt-2 flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <MultiPaneGrid
          paneKeys={panes.keys}
          labels={panes.labels}
          inModal={false}
          columns={settings.columns}
          onPaneWidthsChange={() => {}}
          renderPane={(key, i) => (
            <VolumePane key={key} name={metric.name} points={seriesPoints[i] ?? []} targetStep={stepFor(i)} />
          )}
        />
      </div>
      {values.length > 1 && (
        <StepSlider
          points={slider.sliderPoints}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          keyName={keyName}
          className="mt-2 shrink-0"
        />
      )}
    </div>
  );

  return (
    <CardShell
      cardKind="volume"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={values.length > 0 ? `${keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${values.length})` : `${metric.count} pts`}
      defaultHeight={plotCardPolicy("volume").defaultHeight}
      onRemove={onRemove}
      onSettings={() => setSettingsOpen(true)}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={
        <VolumeSettingsPanel
          ctl={ctl}
          mode="card"
          ctx={{ multi: panes.shown.length > 1, scalarMetrics, following: slider.sync != null }}
        />
      }
      modalOpen={settingsOpen}
      onModalClose={() => setSettingsOpen(false)}
      modalContent={body}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {settingsOpen ? null : body}
    </CardShell>
  );
}
