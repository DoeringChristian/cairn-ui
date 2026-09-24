import { useCallback, useMemo, useRef, useState } from "react";

import { useSequencesForRuns } from "../api/hooks";
import type { SequenceMeta } from "../api/types";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import {
  classColor,
  EMPTY_OVERLAY_SUMMARY,
  mergeOverlaySummaries,
  type OverlaySummary,
  type OverlayView,
} from "../lib/overlays";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import type { BaseCardSettings } from "./card-kit";
import { ExternalBaselinePicker } from "./card-kit/ExternalBaselinePicker";
import MultiPaneGrid from "./card-kit/MultiPaneGrid";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import { resolveAtStep } from "./card-kit/resolve-at-step";
import { seriesLabel } from "./card-kit/series-identity";
import { useRunInfo } from "./card-kit/use-run-info";
import { useStepSlider } from "./card-kit/use-step-slider";
import { type PaneTransform } from "./image/ImagePane";
import ImagePointView from "./image/ImagePointView";
import SettingsSection from "./settings/SettingsSection";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface ImageCardSettings extends BaseCardSettings {
  showLabels: boolean;
  /** Index into the union of logged steps. */
  sliderStep?: number;
  /** Reference tag; every pane compares against this tag from its own run. */
  reference?: { name: string; context_hash: string };
  /** Fixed reference step; absent follows the slider. */
  referenceStep?: number;
  /** Divider position (fraction of pane width), shared by all panes. */
  split: number;
  /** Overlay annotations (boxes/masks logged with the image). */
  showBoxes: boolean;
  showMasks: boolean;
  maskOpacity: number;
  minScore: number;
  hiddenClasses: number[];
}

const DEFAULTS: ImageCardSettings = {
  version: 1,
  showLabels: true,
  split: 0.5,
  showBoxes: true,
  showMasks: true,
  maskOpacity: 0.5,
  minScore: 0,
  hiddenClasses: [],
};
const IDENTITY: PaneTransform = { scale: 1, x: 0, y: 0 };

type Series = { runId: string; name: string; context_hash: string };


export default function ImageCard({ runId, metric, extraSeries = [], settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(autoOpenSettings ?? false);
  const policy = plotCardPolicy("image");
  const settingsKey = useMemo<CardSettingsKey>(
    () => settingsKeyOverride ?? { runId, metricName: metric.name, contextHash: metric.context_hash },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings<ImageCardSettings>(
    settingsKey,
    useMemo(() => ({ ...DEFAULTS, colSpan: policy.colSpan }), [policy.colSpan]),
  );

  const series = useMemo<Series[]>(() => {
    const seen = new Set<string>();
    return [{ runId, name: metric.name, context_hash: metric.context_hash }, ...extraSeries]
      .map((s) => ({ runId: s.runId, name: s.name, context_hash: s.context_hash }))
      .filter((s) => {
        const key = `${s.runId}:${s.name}:${s.context_hash}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [runId, metric.name, metric.context_hash, extraSeries]);
  const paneKeys = useMemo(() => series.map((s) => `${s.runId}:${s.name}:${s.context_hash}`), [series]);
  const runIds = useMemo(() => [...new Set(series.map((s) => s.runId))], [series]);
  useRunInfo(runIds);
  const labels = useMemo(() => {
    const multiRun = runIds.length > 1;
    return new Map(series.map((s, i) => [paneKeys[i]!, seriesLabel(s, runId, multiRun, runIds)]));
  }, [series, paneKeys, runId, runIds]);

  // Foreground sequences, then (when a reference tag is set) the same tag per run.
  const reference = settings.reference;
  const bindings = useMemo(() => [
    ...series.map((s) => ({ runId: s.runId, name: s.name, contextHash: s.context_hash })),
    ...(reference ? series.map((s) => ({ runId: s.runId, name: reference.name, contextHash: reference.context_hash })) : []),
  ], [series, reference]);
  const queries = useSequencesForRuns(bindings);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const { points, refPoints, anyLoading } = useMemo(() => {
    const withArtifact = (i: number) => (queries[i]?.data?.points ?? []).filter((p) => p.artifact_hash);
    return {
      points: series.map((_, i) => withArtifact(i)),
      refPoints: reference ? series.map((_, i) => withArtifact(series.length + i)) : [],
      anyLoading: queries.some((q) => q.isLoading),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, series, reference]);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: points,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });
  const stepPoints = useMemo(() => globalSteps.map((step) => ({ step, wall_time: null })), [globalSteps]);

  // Zoom/pan shared by every pane.
  const [transform, setTransform] = useState<PaneTransform>(IDENTITY);
  const viewModified = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  // Divider drags stay local until release; arrow keys persist immediately.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const split = dragSplit ?? settings.split;
  const onSplitChange = useCallback((value: number, final: boolean) => {
    if (final) {
      setDragSplit(null);
      updateSettings({ split: value });
    } else {
      setDragSplit(value);
    }
  }, [updateSettings]);

  const overlayView = useMemo<OverlayView>(() => ({
    showBoxes: settings.showBoxes,
    showMasks: settings.showMasks,
    maskOpacity: settings.maskOpacity,
    minScore: settings.minScore,
    hiddenClasses: settings.hiddenClasses,
  }), [settings.showBoxes, settings.showMasks, settings.maskOpacity, settings.minScore, settings.hiddenClasses]);

  // Each pane reports what overlays its images carry; the settings show the union.
  const [paneOverlays, setPaneOverlays] = useState<Record<string, OverlaySummary>>({});
  const reporters = useRef(new Map<string, (s: OverlaySummary) => void>());
  const reporterFor = (key: string) => {
    let fn = reporters.current.get(key);
    if (!fn) {
      fn = (s: OverlaySummary) => setPaneOverlays((prev) => (prev[key] === s ? prev : { ...prev, [key]: s }));
      reporters.current.set(key, fn);
    }
    return fn;
  };
  const overlaySummary = useMemo(
    () => mergeOverlaySummaries(paneKeys.map((k) => paneOverlays[k] ?? EMPTY_OVERLAY_SUMMARY)),
    [paneKeys, paneOverlays],
  );
  const toggleClass = (id: number, visible: boolean) => {
    const hidden = new Set(settings.hiddenClasses);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    updateSettings({ hiddenClasses: [...hidden].sort((a, b) => a - b) });
  };

  const renderPane = (key: string, index: number) => (
    <ImagePointView
      key={key}
      metricName={metric.name}
      point={resolveAtStep(points[index] ?? [], currentStep, { nearest: true })}
      refPoint={reference
        ? resolveAtStep(refPoints[index] ?? [], settings.referenceStep ?? currentStep, { nearest: true })
        : null}
      refLabel={reference?.name}
      split={split}
      onSplitChange={onSplitChange}
      transform={transform}
      onTransformChange={setTransform}
      loadingHint={anyLoading}
      overlayView={overlayView}
      onOverlays={reporterFor(key)}
    />
  );

  const settingsPanel = (
    <>
      <SettingsSection title="Compare with" first>
        <p className="mb-1 text-xs text-fg-muted">
          Choose a reference image tag. Each pane splits its image against that tag from its own run.
        </p>
        {reference && (
          <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
            <span className="mono min-w-0 flex-1 truncate">{reference.name}</span>
            <button
              type="button"
              onClick={() => updateSettings({ reference: undefined, referenceStep: undefined })}
              className="shrink-0 text-fg-subtle hover:text-fg"
              aria-label="Remove reference"
            >
              ×
            </button>
          </div>
        )}
        <ExternalBaselinePicker
          runId={runId}
          objectType="image"
          currentMetricName={metric.name}
          selected={reference?.name}
          onSelect={(name, context_hash) => updateSettings({ reference: { name, context_hash } })}
        />
        {reference && (
          <>
            <Toggle
              label="Pin reference step"
              checked={settings.referenceStep != null}
              onChange={(pinned) => updateSettings({ referenceStep: pinned ? currentStep : undefined })}
              description="Off follows the slider; on keeps the reference fixed."
            />
            {settings.referenceStep != null && (
              <Slider
                label="Reference step"
                value={settings.referenceStep}
                onChange={(v) => updateSettings({ referenceStep: Math.round(v) })}
                min={globalSteps[0] ?? 0}
                max={globalSteps[globalSteps.length - 1] ?? 1}
                step={1}
                format={(v) => Math.round(v).toString()}
              />
            )}
          </>
        )}
      </SettingsSection>
      {(overlaySummary.hasBoxes || overlaySummary.hasMasks) && (
        <SettingsSection title="Overlays">
          {overlaySummary.hasBoxes && (
            <Toggle label="Show boxes" checked={settings.showBoxes} onChange={(showBoxes) => updateSettings({ showBoxes })} />
          )}
          {overlaySummary.hasBoxes && overlaySummary.hasScores && (
            <Slider
              label="Min box score"
              value={settings.minScore}
              onChange={(minScore) => updateSettings({ minScore })}
              min={0}
              max={1}
              step={0.01}
              format={(v) => v.toFixed(2)}
              description="Boxes without a score always show."
            />
          )}
          {overlaySummary.hasMasks && (
            <>
              <Toggle label="Show masks" checked={settings.showMasks} onChange={(showMasks) => updateSettings({ showMasks })} />
              <Slider
                label="Mask opacity"
                value={settings.maskOpacity}
                onChange={(maskOpacity) => updateSettings({ maskOpacity })}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </>
          )}
          {overlaySummary.classes.length > 0 && (
            <div className="py-1">
              <p className="mb-1 text-sm text-fg">Classes</p>
              <ul className="space-y-0.5">
                {overlaySummary.classes.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={!settings.hiddenClasses.includes(c.id)}
                        onChange={(e) => toggleClass(c.id, e.target.checked)}
                      />
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: classColor(c.id) }} aria-hidden="true" />
                      <span className="min-w-0 truncate">{c.name}</span>
                      <span className="mono ml-auto text-fg-subtle">{c.id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsSection>
      )}
      <SettingsSection title="Display">
        <Toggle label="Show pane labels" checked={settings.showLabels} onChange={(showLabels) => updateSettings({ showLabels })} />
      </SettingsSection>
    </>
  );

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={settings.showLabels ? labels : new Map()}
        inModal={false}
        onPaneWidthsChange={() => {}}
        renderPane={renderPane}
      />
      {globalSteps.length > 1 && (
        <StepSlider points={stepPoints} currentIndex={safeIdx} onChange={onSliderChange} immediate className="shrink-0 px-1 pb-1 pt-2" />
      )}
    </div>
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={globalSteps.length > 0 ? `step ${currentStep}` : undefined}
      cardKind="image"
      defaultHeight={policy.defaultHeight}
      onRemove={onRemove}
      onSettings={() => setSettingsOpen(true)}
      onResetView={() => setTransform(IDENTITY)}
      viewModified={viewModified}
      settingsPanel={settingsPanel}
      modalContent={body}
      modalOpen={settingsOpen}
      onModalClose={() => setSettingsOpen(false)}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-hidden">{settingsOpen ? null : body}</div>
    </CardShell>
  );
}
