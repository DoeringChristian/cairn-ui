import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as THREE from "three";
import { useSequencesForRuns } from "../../api/hooks";
import { api } from "../../api/client";
import type { SequenceMeta, SequencePoint } from "../../api/types";
import { safeJsonParse } from "../../lib/format";
import { downloadArtifact, artifactFilename } from "../../lib/download";
import type { CardSettingsKey } from "../../lib/card-settings";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { useCardDrop } from "../../lib/use-series-drop";
import { shortRunLabel, useRunMetadataVersion } from "../../lib/run-label";
import { seriesKey } from "../../lib/series-utils";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid, type BaseCardSettings } from "../card-kit";
import type { SeriesRef } from "../card-kit/use-card-series";
import { useOverlaySlot } from "../card-kit/use-overlay-slot";
import { plotCardPolicy } from "../card-kit/plot-card-policy";
import AddToComparisonButton from "../AddToComparisonButton";
import CardShell from "../CardShell";
import SeriesChipStrip from "../SeriesChipStrip";
import StepSlider from "../StepSlider";
import SettingsSection from "../settings/SettingsSection";
import Toggle from "../settings/Toggle";
import Viewer3D from "./Viewer3D";
import { CameraLink } from "./camera-link";
import { disposeObject, propertyNames, useArtifactArrays, type ArtifactArrays, type Scene3DMeta } from "./artifact-arrays";

/** Props every 3D card takes — the same shape CardRenderer passes to series cards. */
export interface Scene3DCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/** What differs between the pointcloud / mesh / boxes3d cards. */
export interface Scene3DKind<V extends object, M extends Scene3DMeta> {
  kind: "pointcloud" | "mesh" | "boxes3d";
  /** Noun for the empty state ("no point cloud logged yet"). */
  noun: string;
  defaultView: V;
  build: (arrays: ArtifactArrays, view: V) => THREE.Object3D;
  caption: (meta: M) => string;
  viewSettings: (args: {
    view: V;
    setView: (patch: Partial<V>) => void;
    meta: M | null;
    properties: string[];
  }) => ReactNode;
}

interface Scene3DSettings<V> extends BaseCardSettings {
  metrics: SeriesRef[];
  sliderStep?: number;
  syncCameras: boolean;
  view: Partial<V>;
}

function ScenePane<V extends object, M extends Scene3DMeta>({
  spec,
  points,
  targetStep,
  view,
  link,
  resetKey,
}: {
  spec: Scene3DKind<V, M>;
  points: SequencePoint[];
  targetStep: number;
  view: V;
  link: CameraLink | null;
  resetKey: number;
}) {
  const current = resolveAtStep(points, targetStep);
  const metaJson = current?.artifact_metadata;
  const meta = useMemo(() => safeJsonParse<M>(metaJson), [metaJson]);
  const q = useArtifactArrays(current?.artifact_hash ?? null);

  const built = useMemo(() => {
    if (!q.data) return { objects: [] as THREE.Object3D[], error: null };
    try {
      return { objects: [spec.build(q.data, view)], error: null };
    } catch (err) {
      return { objects: [] as THREE.Object3D[], error: err instanceof Error ? err.message : String(err) };
    }
  }, [spec, q.data, view]);
  useEffect(() => () => built.objects.forEach(disposeObject), [built]);

  if (!current) {
    return <div className="flex h-full items-center justify-center text-sm text-fg-muted">no {spec.noun} logged yet</div>;
  }
  const error = q.error ? String(q.error) : built.error;
  return (
    <div className="relative h-full w-full overflow-hidden rounded bg-bg">
      <Viewer3D objects={built.objects} link={link} resetKey={resetKey} />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-red-500">{error}</div>
      ) : q.isFetching ? (
        <div className="absolute right-1 top-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted">loading…</div>
      ) : null}
      {meta && (
        <div className="mono pointer-events-none absolute bottom-1 left-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-subtle">
          {spec.caption(meta)}
        </div>
      )}
    </div>
  );
}

/** One pane per series (run), a shared step slider, and orbit cameras that follow each other. */
export default function Scene3DCard<V extends object, M extends Scene3DMeta>({
  spec,
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Scene3DCardProps & { spec: Scene3DKind<V, M> }) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<Scene3DSettings<V>>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (_seed, metrics) => ({ version: 1, metrics, syncCameras: true, view: {} }),
    });
  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const queries = useSequencesForRuns(
    effectiveMetrics.map((m) => ({ runId: m.runId ?? runId, name: m.name, contextHash: m.context_hash })),
  );
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join(","), effectiveMetrics.length],
  );

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });
  const sliderPoints = useMemo(() => globalSteps.map((step) => ({ step })), [globalSteps]);

  const viewJson = JSON.stringify(settings.view ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo<V>(() => ({ ...spec.defaultView, ...settings.view }), [spec, viewJson]);
  const setView = (patch: Partial<V>) => updateSettings({ view: { ...settings.view, ...patch } });

  const link = useMemo(() => (settings.syncCameras ? new CameraLink() : null), [settings.syncCameras]);
  const [resetKey, setResetKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(autoOpenSettings ?? false);
  const slot = useOverlaySlot(settingsOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  const seedCurrent = resolveAtStep(seriesPoints[0] ?? [], currentStep);
  const seedMeta = safeJsonParse<M>(seedCurrent?.artifact_metadata);

  const runMetaVersion = useRunMetadataVersion();
  useRunInfo(allRunIds);

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );
  const isMulti = effectiveMetrics.length > 1;
  const subtitle = globalSteps.length > 0
    ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
    : `${metric.count} pts`;


  return (
    <CardShell
      cardKind={spec.kind}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={plotCardPolicy(spec.kind).defaultHeight}
      onSettings={() => setSettingsOpen(true)}
      onResetView={() => setResetKey((k) => k + 1)}
      onRemove={onRemove}
      onDownload={seedCurrent?.artifact_hash
        ? () => downloadArtifact(
            api.artifactUrl(seedCurrent.artifact_hash!),
            artifactFilename(metric.name, seedCurrent.step, seedCurrent.artifact_mime, ".npz"),
          )
        : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType={spec.kind} series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={
        <SettingsSection title="3D view" first>
          {spec.viewSettings({ view, setView, meta: seedMeta, properties: propertyNames(seedMeta) })}
          {isMulti && (
            <Toggle
              label="Sync cameras"
              checked={settings.syncCameras}
              onChange={(syncCameras) => updateSettings({ syncCameras })}
            />
          )}
          <button
            type="button"
            className="mt-2 w-full rounded border border-border px-2 py-1 text-xs hover:bg-bg-hover"
            onClick={() => setResetKey((k) => k + 1)}
          >
            Reset camera
          </button>
        </SettingsSection>
      }
      modalOpen={settingsOpen}
      onModalClose={() => setSettingsOpen(false)}
      modalContent={<div ref={slot.slotRef} className="h-full w-full" />}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {/* One stable tree position for the viewers: opening the settings modal
          only re-styles this box over the modal's slot, so the GL contexts and
          cameras survive. */}
      <div
        className={settingsOpen ? "min-h-0 min-w-0 overflow-hidden" : "mt-2 min-h-0 min-w-0 flex-1 overflow-hidden"}
        style={slot.style}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <MultiPaneGrid
              paneKeys={paneKeys}
              labels={paneLabels}
              inModal={false}
              onPaneWidthsChange={() => {}}
              renderPane={(key, i) => (
                <ScenePane
                  key={key}
                  spec={spec}
                  points={seriesPoints[i] ?? []}
                  targetStep={currentStep}
                  view={view}
                  link={link}
                  resetKey={resetKey}
                />
              )}
            />
          </div>
          {globalSteps.length > 1 && (
            <StepSlider points={sliderPoints} currentIndex={safeIdx} onChange={onSliderChange} className="mt-2 shrink-0" />
          )}
          {isMulti && (
            <SeriesChipStrip
              metrics={effectiveMetrics}
              controlledSeries={controlledSeries}
              runId={runId}
              allRunIds={allRunIds}
              onMetricsChange={(next) => updateSettings({ metrics: next })}
            />
          )}
        </div>
      </div>
    </CardShell>
  );
}
