import { useMemo, useRef } from "react";
import { useSequencesForRuns } from "../api/hooks";
import { api } from "../api/client";
import type { SequencePoint } from "../api/types";
import { safeJsonParse } from "../lib/format";
import { artifactFilename } from "../lib/download";
import { useCardDrop } from "../lib/use-series-drop";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
import { useCardSeries, useStepSlider, resolveAtStep, MultiPaneGrid } from "./card-kit";
import { instanceDefaults, type VolumeSettings } from "./cards-settings/volume";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import UnsupportedArtifact from "./UnsupportedArtifact";
import type { Scene3DCardProps } from "./viewer3d/Scene3DCard";

interface VolumeMeta {
  shape: [number, number, number];
  dtype: string;
  vmin: number;
  vmax: number;
}

function VolumePane({ name, points, targetStep }: { name: string; points: SequencePoint[]; targetStep: number }) {
  const current = resolveAtStep(points, targetStep);
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
}: Scene3DCardProps) {
  const { ctl, effectiveMetrics, allRunIds, multipleRuns } =
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
  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, ctl.set);

  const queries = useSequencesForRuns(
    effectiveMetrics.map((m) => ({ runId: m.runId ?? runId, name: m.name })),
  );
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join(","), effectiveMetrics.length],
  );
  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
  });
  const sliderPoints = useMemo(() => globalSteps.map((step) => ({ step })), [globalSteps]);

  const runMetaVersion = useRunMetadataVersion();
  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <CardShell
      cardKind="volume"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={globalSteps.length > 0 ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})` : `${metric.count} pts`}
      defaultHeight={plotCardPolicy("volume").defaultHeight}
      onRemove={onRemove}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
    >
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <MultiPaneGrid
            paneKeys={paneKeys}
            labels={paneLabels}
            inModal={false}
            onPaneWidthsChange={() => {}}
            renderPane={(key, i) => (
              <VolumePane key={key} name={metric.name} points={seriesPoints[i] ?? []} targetStep={currentStep} />
            )}
          />
        </div>
        {globalSteps.length > 1 && (
          <StepSlider points={sliderPoints} currentIndex={safeIdx} onChange={onSliderChange} className="mt-2 shrink-0" />
        )}
      </div>
    </CardShell>
  );
}
