/**
 * Shared shell for the stepped media cards (markdown, HTML, audio, video):
 * one artifact per step, a step slider over the union of every series' steps,
 * and a side-by-side pane grid with a chip strip once the card holds more
 * than one series. Each card supplies only its own settings, its settings
 * panel, and how one artifact renders.
 *
 * A gallery point (a tracked list of the card's media, lib/media/gallery.ts)
 * renders as a grid of its items, each through the same `renderArtifact`,
 * swapped in as a whole once every item is warm (see GalleryView).
 *
 * A card may compare every pane against a reference tag (`reference`): the
 * tag is resolved in each pane's own run (see resolveReference) and handed
 * to the renderer with the point; a gallery pairs with a reference gallery
 * item by item (a single reference serves every item).
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useSequencesForRuns } from "../../api/hooks";
import { api } from "../../api/client";
import { downloadArtifact, artifactFilename } from "../../lib/download";
import { cardOverridesStorageKey, type CardSettingsKey, type SettingsController } from "../../lib/card-settings";
import { useCardDrop } from "../../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { gridValues, normalizeSlots, slotValue } from "../../lib/media/panel-layout";
import { STEP_KEY, formatKeyValue } from "../../lib/media/slider-key";
import { useNeighbourPrefetch } from "../../lib/media/use-settled-frame";
import { galleryCount, isGalleryPoint } from "../../lib/media/gallery";
import { prefetchPointOrGallery } from "../../lib/media/gallery-query";
import GalleryView, { useSettledGalleries } from "./GalleryView";
import type { SequenceMeta, SequencePoint } from "../../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, MultiPaneGrid } from "../card-kit";
import { resolveReference } from "../card-kit/resolve-at-step";
import ComparePanes from "../card-kit/ComparePanes";
import GridPanes from "../card-kit/GridPanes";
import { useMediaPanes, useScalarMetricNames } from "../card-kit/use-media-panes";
import { steppedMediaInstanceDefaults, type SteppedMediaSettings } from "../cards-settings/stepped-media";
import type { MediaPanelCtx, ReferencePanelCtx } from "../settings-panels/media-panel-kit";
import AddToReportButton from "../AddToReportButton";
import CardShell from "../CardShell";
import SeriesChipStrip from "../SeriesChipStrip";
import StepSlider from "../StepSlider";

/** Props every stepped media card receives from CardRenderer. */
export interface SteppedMediaCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/** One resolved artifact handed to the card's renderer. */
export interface MediaView<S> {
  point: SequencePoint;
  /** `point.artifact_hash`, known non-null. */
  hash: string;
  /** Series name of the pane. */
  name: string;
  settings: S;
  /**
   * True when this is the card's only pane (it fills the card); false for one
   * pane of a grid or one item of a gallery.
   */
  single: boolean;
  inModal: boolean;
  /** Stable id of the pane (per series and layout slot; `#i` added per gallery item). */
  paneId: string;
  /** How many media the card shows at once (each gallery item counts). */
  paneCount: number;
  /** The card follows a section media sync right now. */
  following: boolean;
  /** The reference this pane (or gallery item) compares against; null without one. */
  reference: SequencePoint | null;
  /** The reference's series name. */
  referenceName?: string;
  /** Patch the card's settings (e.g. a divider position). */
  update: (patch: Partial<S>, opts?: { mergeKey?: string }) => void;
}

/** Runtime info a stepped media settings panel gets. */
export interface SteppedMediaPanelCtx extends MediaPanelCtx, ReferencePanelCtx {
  paneKeys: readonly string[];
}

interface Props<S extends SteppedMediaSettings> extends SteppedMediaCardProps {
  /** Card kind, used for CardShell sizing and as the comparison card type. */
  kind: "markdown" | "html" | "audio" | "video";
  /** Word in the empty state: "no {noun} logged yet". */
  noun: string;
  /** Gallery item captions as chips over the items (pictures: video, audio) rather than a line above. */
  captionOverlay?: boolean;
  /** MIME type for the download filename when the point carries none. */
  defaultMime: string;
  defaultHeight?: number;
  /**
   * How a grid pane whose series starts logging after the current step
   * resolves: true shows that series' first artifact, false shows the empty
   * state (see resolveAtStep's `nearest`).
   */
  nearest: boolean;
  settingsPanel: (ctl: SettingsController<S>, ctx: SteppedMediaPanelCtx) => ReactNode;
  renderArtifact: (view: MediaView<S>) => ReactNode;
  /**
   * Warm what `renderArtifact` needs for one point (fetched text, a decoded
   * poster), so the slider's neighbours render without waiting. Omitted: no
   * prefetch (audio streams on demand).
   */
  prefetch?: (qc: QueryClient, point: SequencePoint, signal: AbortSignal) => Promise<unknown>;
  /** `prefetch`'s work for this point is done already (a gallery swaps at once then). */
  peek?: (qc: QueryClient, point: SequencePoint) => boolean;
  /** Extra controls between the panes and the slider (the video transport). */
  footer?: (args: { settings: S; paneCount: number; following: boolean }) => ReactNode;
  /**
   * The reference tag every pane compares against (resolved in the pane's
   * own run), at a pinned step or following the pane's; null for none.
   */
  reference?: (settings: S) => { name: string; step?: number } | null;
  /** A zoom/pan the card's panes share: the header's reset-view button. */
  viewReset?: { modified: boolean; reset: () => void };
}

function Placeholder({ loading, noun }: { loading: boolean; noun: string }) {
  if (loading) return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  return <div className="text-sm text-fg-muted">no {noun} logged yet</div>;
}

export default function SteppedMediaCard<S extends SteppedMediaSettings>({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
  kind,
  noun,
  defaultMime,
  defaultHeight,
  nearest,
  settingsPanel,
  renderArtifact,
  prefetch,
  peek,
  footer,
  reference: referenceOf,
  viewReset,
  captionOverlay,
}: Props<S>) {
  const { ctl, effectiveMetrics, allRunIds } =
    useCardSeries<S>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: kind,
      instanceDefaults: steppedMediaInstanceDefaults as (seed: { name: string }) => Partial<S>,
    });
  const settings = ctl.value;
  const cardId = cardOverridesStorageKey(settingsKeyOverride ?? { runId, metricName: metric.name });

  // Patches of the shell-owned fields; generic S can't prove they are Partial<S>.
  const updateShared = ctl.set as unknown as (patch: Partial<SteppedMediaSettings>, opts?: { mergeKey?: string }) => void;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateShared);

  const panes = useMediaPanes(effectiveMetrics, runId, settings.maxRuns);
  const shown = panes.shown;
  const paneKeys = panes.keys;
  const reference = referenceOf?.(settings) ?? null;
  const refName = reference?.name ?? null;
  // Foreground sequences, then (with a reference tag) the same tag per pane's run.
  const queries = useSequencesForRuns([
    ...shown.map((m, i) => ({ runId: panes.runIds[i]!, name: m.name })),
    ...(refName ? shown.map((_, i) => ({ runId: panes.runIds[i]!, name: refName })) : []),
  ]);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const { seriesPoints, refPoints } = useMemo(() => {
    const withArtifact = (i: number) => (queries[i]?.data?.points ?? []).filter((p) => p.artifact_hash);
    return {
      seriesPoints: shown.map((_, i) => withArtifact(i)),
      refPoints: refName ? shown.map((_, i) => withArtifact(shown.length + i)) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, shown.length, refName]);
  const loadingAt = (i: number) => queries[i]?.isLoading ?? false;

  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: updateShared,
    sliderKey: settings.sliderKey,
    seriesRunIds: panes.runIds,
    sync: { cardId, follow: settings.followSection },
  });
  const { values, safeIdx, currentValue, keyName, stepFor } = slider;
  const following = slider.sync != null;
  const scalarMetrics = useScalarMetricNames(runId);

  const pointAt = (i: number, value: number, near: boolean): SequencePoint | null => {
    const step = stepFor(i, value, { nearest: near });
    return step == null ? null : resolveAtStep(seriesPoints[i] ?? [], step, { nearest: near });
  };
  const refAt = (i: number, point: SequencePoint | null): SequencePoint | null =>
    reference ? resolveReference(refPoints[i] ?? [], point, reference.step) : null;
  const qc = useQueryClient();
  const prefetchItem = prefetch ? (p: SequencePoint, signal: AbortSignal) => prefetch(qc, p, signal) : undefined;
  const peekItem = peek ? (p: SequencePoint) => peek(qc, p) : undefined;
  useNeighbourPrefetch(settings.panelMode !== "grid" ? values.length : 0, safeIdx, (j) =>
    shown.flatMap((_, i) => {
      const p = pointAt(i, values[j]!, nearest);
      return [p, refAt(i, p)].flatMap((q) => {
        if (!q?.artifact_hash || (!prefetch && !isGalleryPoint(q))) return [];
        return [{ key: `${kind}:${q.artifact_hash}`, run: (signal: AbortSignal) => prefetchPointOrGallery(qc, q, prefetchItem, signal) }];
      });
    }),
  );

  // The first pane's artifact drives the header download.
  const current = pointAt(0, currentValue, false);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );

  const subtitle =
    values.length > 0
      ? `${keyName === STEP_KEY ? "step" : keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${values.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const mode = settings.panelMode;
  const paneOptions = useMemo(
    () => paneKeys.map((k, i) => ({
      key: k,
      label: panes.labels.get(k) ?? shown[i]!.name,
      color: panes.multiRun ? panes.colors.get(panes.runIds[i]!) : undefined,
    })),
    [paneKeys, panes, shown],
  );
  const compareSlots = useMemo(() => normalizeSlots(settings.compareSlots, paneKeys), [settings.compareSlots, paneKeys]);
  const gridCols = mode === "grid" ? gridValues(values, settings.columns) : [];
  // Every pane on screen with its point (ids as `view` gets them below).
  const paneRequests: Array<{ id: string; index: number; point: SequencePoint | null }> = mode === "grid"
    ? shown.flatMap((_, i) => gridCols.map((v, col) => ({ id: `grid:${i}:${col}`, index: i, point: pointAt(i, v, false) })))
    : mode === "compare"
      ? compareSlots.map((slot, i) => {
          const idx = paneKeys.indexOf(slot.pane);
          return { id: `compare:${i}`, index: idx, point: idx < 0 ? null : pointAt(idx, slotValue(slot, settings.compareLinked, currentValue), nearest) };
        })
      : shown.length <= 1
        ? [{ id: paneKeys[0] ?? "single", index: 0, point: pointAt(0, currentValue, false) }]
        : paneKeys.map((key, i) => ({ id: key, index: i, point: pointAt(i, currentValue, nearest) }));
  const panePoints = paneRequests.map((r) => r.point);
  // Gallery panes (and reference galleries) swap steps together (runs side by side never differ).
  const galleryFrames = useSettledGalleries(
    [
      ...paneRequests,
      ...(reference ? paneRequests.map((r) => ({ id: `${r.id}~ref`, point: r.index < 0 ? null : refAt(r.index, r.point) })) : []),
    ],
    { prefetchItem, peekItem },
  );
  const paneCount = panePoints.reduce((n, p) => n + Math.max(1, galleryCount(p)), 0);

  const view = (i: number, point: SequencePoint | null, paneId: string, single: boolean, inModal: boolean) => {
    if (!point?.artifact_hash) return <Placeholder loading={loadingAt(i)} noun={noun} />;
    const name = shown[i]?.name ?? metric.name;
    const ref = refAt(i, point);
    // A reference gallery pairs item by item; one plain reference serves every item.
    const refGallery = ref && isGalleryPoint(ref) ? galleryFrames?.get(`${paneId}~ref`)?.itemPoints ?? [] : null;
    const refFor = (j: number): SequencePoint | null =>
      refGallery ? (refGallery.length > 1 ? refGallery[j] ?? null : refGallery[0] ?? null) : ref;
    const common = { name, settings, inModal, paneCount, following, referenceName: refName ?? undefined, update: ctl.set };
    if (isGalleryPoint(point)) {
      const gallery = (
        <GalleryView
          point={point}
          frame={galleryFrames?.get(paneId)}
          captionOverlay={captionOverlay}
          prefetchItem={prefetchItem}
          peekItem={peekItem}
          renderItem={(item, j) => renderArtifact({
            ...common,
            point: item,
            hash: item.artifact_hash!,
            single: false,
            paneId: `${paneId}#${j}`,
            reference: refFor(j),
          })}
        />
      );
      return single ? <div className="min-h-0 flex-1 overflow-auto">{gallery}</div> : gallery;
    }
    return renderArtifact({
      ...common,
      point,
      hash: point.artifact_hash,
      single,
      paneId,
      reference: refFor(0),
    });
  };

  const renderPanes = (inModal: boolean) => {
    if (mode === "grid") {
      return (
        <GridPanes
          rows={paneOptions}
          columns={gridCols.map((v) => ({ value: v, label: `${keyName} ${formatKeyValue(v)}` }))}
          current={currentValue}
          onColumnClick={slider.setValue}
          rowHeight={inModal ? 220 : 140}
          renderCell={(row, col) => (
            <div className="h-full overflow-auto">
              {view(row, pointAt(row, gridCols[col]!, false), `grid:${row}:${col}`, false, inModal)}
            </div>
          )}
        />
      );
    }
    if (mode === "compare") {
      return (
        <ComparePanes
          slots={compareSlots}
          onSlotsChange={(slots) => updateShared({ compareSlots: slots })}
          linked={settings.compareLinked}
          onLinkedChange={(linked, slots) => updateShared({ compareLinked: linked, compareSlots: slots })}
          panes={paneOptions}
          values={values}
          keyName={keyName}
          current={currentValue}
          columns={settings.columns}
          renderSlot={(slot, _value, i) => {
            const idx = paneKeys.indexOf(slot.pane);
            if (idx < 0) return null;
            const v = slotValue(slot, settings.compareLinked, currentValue);
            return <div className="h-full overflow-auto">{view(idx, pointAt(idx, v, nearest), `compare:${i}`, false, inModal)}</div>;
          }}
        />
      );
    }
    if (shown.length <= 1) {
      return view(0, pointAt(0, currentValue, false), paneKeys[0] ?? "single", true, inModal);
    }
    return (
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={panes.labels}
        colors={panes.paneColors}
        inModal={inModal}
        columns={settings.columns}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateShared({ paneWidths: w })}
        renderPane={(key, i) => view(i, pointAt(i, currentValue, nearest), key, false, inModal)}
      />
    );
  };

  const renderContent = (inModal: boolean) => (
    <>
      {renderPanes(inModal)}
      {footer?.({ settings, paneCount, following })}
      <StepSlider
        points={slider.sliderPoints}
        currentIndex={safeIdx}
        onChange={slider.onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateShared({ xAxis: m })}
        keyName={keyName}
        className="mt-3"
      />
      {effectiveMetrics.length > 1 && (
        <SeriesChipStrip
          metrics={effectiveMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => updateShared({ metrics: next })}
        />
      )}
    </>
  );

  return (
    <CardShell cardKind={kind}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateShared}
      title={metric.name}
      subtitle={subtitle}
      subtitleCollapsedOnly={values.length > 1}
      defaultHeight={defaultHeight}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? defaultMime)) : undefined}
      addToReportSlot={<AddToReportButton cardType={kind} series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      onResetView={viewReset?.reset}
      viewModified={viewReset?.modified}
      settingsPanel={settingsPanel(ctl, {
        runId,
        metricName: metric.name,
        globalSteps: slider.globalSteps,
        currentStep: slider.currentStep,
        paneKeys,
        multi: shown.length > 1,
        following,
        scalarMetrics,
      })}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      {renderContent(false)}
    </CardShell>
  );
}
