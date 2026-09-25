import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as THREE from "three";
import { useSequencesForRuns } from "../../api/hooks";
import { api } from "../../api/client";
import type { SequenceMeta, SequencePoint } from "../../api/types";
import { safeJsonParse } from "../../lib/format";
import { downloadArtifact, artifactFilename } from "../../lib/download";
import { cardOverridesStorageKey, type CardSettingsKey, type SettingsController } from "../../lib/card-settings";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { useCardDrop } from "../../lib/use-series-drop";
import { formatKeyValue } from "../../lib/media/slider-key";
import { useCardSeries, useStepSlider, resolveAtStep, MultiPaneGrid } from "../card-kit";
import { useMediaPanes, useScalarMetricNames } from "../card-kit/use-media-panes";
import { scene3dInstanceDefaults, type Scene3DSettings } from "../cards-settings/scene3d";
import { useOverlaySlot } from "../card-kit/use-overlay-slot";
import { plotCardPolicy } from "../card-kit/plot-card-policy";
import AddToComparisonButton from "../AddToComparisonButton";
import AddToReportButton from "../AddToReportButton";
import CardShell from "../CardShell";
import SeriesChipStrip from "../SeriesChipStrip";
import StepSlider from "../StepSlider";
import Scene3DSettingsPanel from "../settings-panels/Scene3DSettingsPanel";
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
  /** The pane's step (per run for a slider key); null shows the empty state. */
  targetStep: number | null;
  view: V;
  link: CameraLink | null;
  resetKey: number;
}) {
  const current = targetStep == null ? null : resolveAtStep(points, targetStep);
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
  const { ctl, effectiveMetrics: allMetrics, allRunIds } =
    useCardSeries<Scene3DSettings<V>>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: spec.kind,
      instanceDefaults: scene3dInstanceDefaults as (seed: { name: string }) => Partial<Scene3DSettings<V>>,
    });
  const settings = ctl.value;
  const { highlight: dropHighlight, dropProps } = useCardDrop(allMetrics, ctl.set);
  // The series shown: hidden runs dropped, pinned first, at most `maxRuns` runs.
  const panes = useMediaPanes(allMetrics, runId, settings.maxRuns);
  const effectiveMetrics = panes.shown;
  const scalarMetrics = useScalarMetricNames(runId);

  const queries = useSequencesForRuns(
    effectiveMetrics.map((m) => ({ runId: m.runId ?? runId, name: m.name })),
  );
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join(","), effectiveMetrics.length],
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
  const { values, safeIdx, currentStep, currentValue, onSliderChange, stepFor, keyName } = slider;

  const viewJson = JSON.stringify(settings.view ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo<V>(() => ({ ...spec.defaultView, ...settings.view }), [spec, viewJson]);
  const setView = (patch: Partial<V>) => ctl.set({ view: { ...settings.view, ...patch } });

  const link = useMemo(() => (settings.syncCameras ? new CameraLink() : null), [settings.syncCameras]);
  const [resetKey, setResetKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(autoOpenSettings ?? false);
  const slot = useOverlaySlot(settingsOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  const seedCurrent = resolveAtStep(seriesPoints[0] ?? [], currentStep);
  const seedMeta = safeJsonParse<M>(seedCurrent?.artifact_metadata);

  const paneKeys = panes.keys;
  const paneLabels = panes.labels;

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );
  const isMulti = effectiveMetrics.length > 1;
  const subtitle = values.length > 0
    ? `${keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${values.length})`
    : `${metric.count} pts`;


  return (
    <CardShell
      cardKind={spec.kind}
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
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
      addToReportSlot={<AddToReportButton cardType={spec.kind} series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={
        <Scene3DSettingsPanel
          ctl={ctl as unknown as SettingsController<Scene3DSettings>}
          mode="card"
          ctx={{
            viewSettings: spec.viewSettings({ view, setView, meta: seedMeta, properties: propertyNames(seedMeta) }),
            onResetCamera: () => setResetKey((k) => k + 1),
            multi: isMulti,
            scalarMetrics,
            following: slider.sync != null,
          }}
        />
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
              columns={settings.columns}
              onPaneWidthsChange={() => {}}
              renderPane={(key, i) => (
                <ScenePane
                  key={key}
                  spec={spec}
                  points={seriesPoints[i] ?? []}
                  targetStep={stepFor(i)}
                  view={view}
                  link={link}
                  resetKey={resetKey}
                />
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
          {allMetrics.length > 1 && (
            <SeriesChipStrip
              metrics={allMetrics}
              controlledSeries={controlledSeries}
              runId={runId}
              allRunIds={allRunIds}
              onMetricsChange={(next) => ctl.set({ metrics: next })}
            />
          )}
        </div>
      </div>
    </CardShell>
  );
}
