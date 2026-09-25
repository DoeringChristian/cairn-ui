import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSequencesForRuns } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { cardOverridesStorageKey, useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { ImageCardSettings } from "./cards-settings/image";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import {
  EMPTY_OVERLAY_SUMMARY,
  mergeOverlaySummaries,
  type OverlaySummary,
  type OverlayView,
} from "../lib/overlays";
import { gridValues, normalizeSlots, slotValue } from "../lib/media/panel-layout";
import { STEP_KEY, formatKeyValue } from "../lib/media/slider-key";
import { useNeighbourPrefetch, useSettledFrame } from "../lib/media/use-settled-frame";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import ComparePanes from "./card-kit/ComparePanes";
import GridPanes from "./card-kit/GridPanes";
import MultiPaneGrid from "./card-kit/MultiPaneGrid";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
import { resolveAtStep } from "./card-kit/resolve-at-step";
import { useMediaPanes, useScalarMetricNames } from "./card-kit/use-media-panes";
import { useStepSlider } from "./card-kit/use-step-slider";
import { type PaneTransform } from "./image/ImagePane";
import ImagePointView from "./image/ImagePointView";
import { imageFrameKey, peekImageFrame, resolveImageFrame, type ImageFrame } from "./image/image-frame";
import ImageSettingsPanel from "./settings-panels/ImageSettingsPanel";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

const IDENTITY: PaneTransform = { scale: 1, x: 0, y: 0 };

type Series = { runId: string; name: string };

export default function ImageCard({ runId, metric, extraSeries = [], settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(autoOpenSettings ?? false);
  const policy = plotCardPolicy("image");
  const settingsKey = useMemo<CardSettingsKey>(
    () => settingsKeyOverride ?? { runId, metricName: metric.name },
    [settingsKeyOverride, runId, metric.name],
  );
  const ctl = useCardSettings<ImageCardSettings>(settingsKey, "image");
  const settings = ctl.value;
  const scalarMetrics = useScalarMetricNames(runId);

  const allSeries = useMemo<Series[]>(() => {
    const seen = new Set<string>();
    return [{ runId, name: metric.name }, ...extraSeries]
      .map((s) => ({ runId: s.runId, name: s.name }))
      .filter((s) => {
        const key = `${s.runId}:${s.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [runId, metric.name, extraSeries]);
  const panes = useMediaPanes(allSeries, runId, settings.maxRuns);
  const series = panes.shown;
  const paneKeys = panes.keys;
  const labels = useMemo(
    () => (panes.multiRun ? panes.labels : new Map(paneKeys.map((k, i) => [k, series[i]!.name]))),
    [panes, paneKeys, series],
  );

  // Foreground sequences, then (when a reference tag is set) the same tag per run.
  const reference = settings.reference;
  const bindings = useMemo(() => [
    ...series.map((s) => ({ runId: s.runId, name: s.name })),
    ...(reference ? series.map((s) => ({ runId: s.runId, name: reference.name })) : []),
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

  const slider = useStepSlider({
    seriesPoints: points,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds: panes.runIds,
    sync: { cardId: cardOverridesStorageKey(settingsKey), follow: settings.followSection },
  });
  const { globalSteps, values, safeIdx, currentValue, currentStep, stepFor, keyName } = slider;

  // Zoom/pan shared by every pane.
  const [transform, setTransform] = useState<PaneTransform>(IDENTITY);
  const viewModified = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  // Divider drags stay local until release; arrow keys persist immediately.
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const split = dragSplit ?? settings.split;
  const onSplitChange = useCallback((value: number, final: boolean) => {
    if (final) {
      setDragSplit(null);
      ctl.set({ split: value }, { mergeKey: "split" });
    } else {
      setDragSplit(value);
    }
  }, [ctl.set]);

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
    () => mergeOverlaySummaries([EMPTY_OVERLAY_SUMMARY, ...Object.values(paneOverlays)]),
    [paneOverlays],
  );

  /** Pane `index` at slider value `value`: its step (per run for a metric key), then its point. */
  const pointAt = (index: number, value: number, nearest: boolean): SequencePoint | null => {
    const step = stepFor(index, value, { nearest });
    return step == null ? null : resolveAtStep(points[index] ?? [], step, { nearest });
  };
  const refAt = (index: number, point: SequencePoint | null): SequencePoint | null => {
    if (!reference) return null;
    const step = settings.referenceStep ?? point?.step;
    return step == null ? null : resolveAtStep(refPoints[index] ?? [], step, { nearest: true });
  };

  // Warm the frames around the slider (every pane's image + reference), so
  // stepping finds them decoded. Grid columns sit at fixed values: nothing to warm.
  const qc = useQueryClient();
  useNeighbourPrefetch(settings.panelMode === "grid" ? 0 : values.length, safeIdx, (j) =>
    series.flatMap((_, index) => {
      const point = pointAt(index, values[j]!, true);
      const ref = refAt(index, point);
      const key = imageFrameKey(point, ref);
      return key ? [{ key, run: (signal: AbortSignal) => resolveImageFrame(qc, point, ref, signal) }] : [];
    }),
  );

  const mode = settings.panelMode;
  const compareSlots = useMemo(
    () => normalizeSlots(settings.compareSlots, paneKeys),
    [settings.compareSlots, paneKeys],
  );
  const gridCols = mode === "grid" ? gridValues(values, settings.columns) : [];

  /** Every pane the card shows right now: its id, series and point (mirrors renderPanes). */
  const paneRequests = (): Array<{ id: string; index: number; point: SequencePoint | null }> => {
    if (mode === "grid") {
      return series.flatMap((_, row) =>
        gridCols.map((v, col) => ({ id: `grid:${row}:${col}`, index: row, point: pointAt(row, v, false) })));
    }
    if (mode === "compare") {
      return compareSlots.flatMap((slot, i) => {
        const index = paneKeys.indexOf(slot.pane);
        const v = slotValue(slot, settings.compareLinked, currentValue);
        return index < 0 ? [] : [{ id: `compare:${i}`, index, point: pointAt(index, v, true) }];
      });
    }
    return paneKeys.map((key, index) => ({ id: key, index, point: pointAt(index, currentValue, true) }));
  };

  // The card swaps ALL its panes in one commit, once every pane's frame
  // (image, reference, gallery entries, masks) is decoded: runs compared
  // side by side never show different steps, an image never shows its
  // reference's step, and until then the previous frame stays on screen.
  const requests = paneRequests().map((r) => ({ ...r, ref: refAt(r.index, r.point) }));
  const cardKey = requests.map((r) => `${r.id}=${imageFrameKey(r.point, r.ref) ?? "-"}`).join(" ");
  const frames = useSettledFrame<Map<string, ImageFrame | null>>(
    cardKey,
    () => {
      const out = new Map<string, ImageFrame | null>();
      for (const r of requests) {
        if (!r.point) { out.set(r.id, null); continue; }
        const f = peekImageFrame(qc, r.point, r.ref);
        if (!f) return undefined;
        out.set(r.id, f);
      }
      return out;
    },
    async (signal) => new Map(await Promise.all(requests.map(async (r) =>
      [r.id, r.point ? await resolveImageFrame(qc, r.point, r.ref, signal) : null] as const))),
  ).frame;

  const renderView = (index: number, id: string) => (
    <ImagePointView
      metricName={series[index]?.name ?? metric.name}
      frame={frames ? frames.get(id) ?? null : undefined}
      refLabel={reference?.name}
      split={split}
      onSplitChange={onSplitChange}
      transform={transform}
      onTransformChange={setTransform}
      loadingHint={anyLoading}
      overlayView={overlayView}
      onOverlays={reporterFor(id)}
      rendering={settings.rendering}
    />
  );

  const paneOptions = useMemo(
    () => paneKeys.map((k, i) => ({
      key: k,
      label: labels.get(k) ?? series[i]!.name,
      color: panes.multiRun ? panes.colors.get(panes.runIds[i]!) : undefined,
    })),
    [paneKeys, labels, series, panes],
  );

  const renderPanes = () => {
    if (mode === "grid") {
      return (
        <GridPanes
          rows={paneOptions}
          columns={gridCols.map((v) => ({ value: v, label: `${keyName} ${formatKeyValue(v)}` }))}
          current={currentValue}
          onColumnClick={slider.setValue}
          renderCell={(row, col) => renderView(row, `grid:${row}:${col}`)}
        />
      );
    }
    if (mode === "compare") {
      return (
        <ComparePanes
          slots={compareSlots}
          onSlotsChange={(slots) => ctl.set({ compareSlots: slots })}
          linked={settings.compareLinked}
          onLinkedChange={(linked, slots) => ctl.set({ compareLinked: linked, compareSlots: slots })}
          panes={paneOptions}
          values={values}
          keyName={keyName}
          current={currentValue}
          columns={settings.columns}
          renderSlot={(slot, _value, i) => {
            const index = paneKeys.indexOf(slot.pane);
            return index < 0 ? null : renderView(index, `compare:${i}`);
          }}
        />
      );
    }
    return (
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={settings.showLabels ? labels : new Map()}
        inModal={false}
        columns={settings.columns}
        onPaneWidthsChange={() => {}}
        renderPane={(key, index) => renderView(index, key)}
      />
    );
  };

  const settingsPanel = (
    <ImageSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        runId,
        metricName: metric.name,
        globalSteps,
        currentStep,
        overlays: overlaySummary,
        paneKeys,
        multi: series.length > 1,
        following: slider.sync != null,
        scalarMetrics,
      }}
    />
  );

  const body = (
    <div className="flex h-full min-h-0 flex-col">
      {renderPanes()}
      {values.length > 1 && (
        <StepSlider
          points={slider.sliderPoints}
          currentIndex={safeIdx}
          onChange={slider.onSliderChange}
          keyName={keyName}
          immediate
          className="shrink-0 px-1 pb-1 pt-2"
        />
      )}
    </div>
  );

  const subtitle = values.length === 0
    ? undefined
    : keyName === STEP_KEY ? `step ${currentStep}` : `${keyName} ${formatKeyValue(currentValue)}`;

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
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
