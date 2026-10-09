import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import ArtifactMark from "./media/ArtifactMark";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useSequencesForRuns } from "../api/hooks";
import { hashSource } from "../lib/viewers/source";
import { safeJsonParse } from "../lib/format";
import { cardOverridesStorageKey, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel } from "../lib/run-label";
import type { SequenceMeta, SequencePoint } from "../api/types";
import GalleryView, { useSettledGalleries } from "./media/GalleryView";
import { prefetchPointOrGallery, type GalleryFrame } from "../lib/media/gallery-query";
import { isGalleryPoint } from "../lib/media/gallery";
import { useNeighbourPrefetch } from "../lib/media/use-settled-frame";
import { STEP_KEY } from "../lib/media/slider-key";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid } from "./card-kit";
import MediaTiles, { useMediaLayout, type LayoutTile } from "./card-kit/MediaTiles";
import {
  instanceDefaults,
  type FigureSettings,
} from "./cards-settings/figure";
import { checkFigureMergeable, mergeFigures, type FigureMergeEntry } from "../lib/plot-utils/figure-merge";
import { mergeRelayout, sceneCameras, type SharedView } from "../lib/plot-utils/view-overrides";
import { createViewLink } from "../lib/plot-utils/scene3d";
import FigureViewer, {
  InteractiveFigure,
  peekFigure,
  plotlySourceQuery,
  pointPlotlySource,
  prefetchFigure,
  type FigureSync,
  type PlotlyFigure,
} from "./viewers/FigureViewer";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import { useMediaPanes, useScalarMetricNames } from "./card-kit/use-media-panes";
import FigureSettingsPanel from "./settings-panels/FigureSettingsPanel";
import StepSlider from "./StepSlider";
import { formatNum } from "../lib/plot-utils/format";
import { plotCardPolicy } from "./card-kit/plot-card-policy";
// The card's own minimum height — passed to every resolveCardHeight read so the
// inner figure agrees with CardShell's outer-box clamp (one clamp source).
const FIGURE_MIN_HEIGHT = cardMinSize("figure").minHeight;
const FIGURE_POLICY = plotCardPolicy("figure");

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}


const EMPTY_FIGURE: PlotlyFigure = { data: [], layout: {} };

/** A figure point as the figure viewer's source. */
const figureSource = (point: SequencePoint) =>
  hashSource(point.artifact_hash!, {
    mime: point.artifact_mime ?? "image/png",
    size: point.artifact_size,
    objectType: "figure",
    meta: safeJsonParse<Record<string, unknown>>(point.artifact_metadata ?? null),
  });

/** Observed content-box width of `ref`'s element (0 until measured). */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * A gallery point's figures in a grid filling the tile, swapped as a whole
 * per step; `indices` are the list items the tile shows (the card's Index).
 */
function FigureGallery({ point, frame, name, sync, indices }: {
  point: SequencePoint;
  frame?: GalleryFrame;
  name: string;
  sync: FigureSync;
  indices?: readonly number[];
}) {
  const qc = useQueryClient();
  return (
    <GalleryView
      point={point}
      frame={frame}
      fill
      minItemHeight={180}
      indices={indices}
      prefetchItem={(p, signal) => prefetchFigure(qc, p, signal)}
      peekItem={(p) => peekFigure(qc, p)}
      renderItem={(item, i) => <FigureViewer source={figureSource(item)} label={`${name} @ step ${item.step} #${i}`} sync={sync} />}
    />
  );
}

export default function FigureInteractiveCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { ctl, effectiveMetrics: allMetrics, allRunIds } =
    useCardSeries<FigureSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      type: "figure",
      instanceDefaults,
    });
  const settings = ctl.value;

  const { highlight: dropHighlight, dropProps } = useCardDrop(allMetrics, ctl.set);
  // The series shown: hidden runs dropped, pinned first, at most `maxRuns` runs.
  const panes = useMediaPanes(allMetrics, runId, settings.maxRuns);
  const shown = panes.shown;
  const paneKeys = panes.keys;
  const runColors = panes.colors;
  const scalarMetrics = useScalarMetricNames(runId);

  const queries = useSequencesForRuns(shown.map((m, i) => ({ runId: panes.runIds[i]!, name: m.name })));
  const dataKey = queries.map((q) => q.dataUpdatedAt).join("|");
  const seriesPoints = useMemo(
    () => queries.map((q) => (q.data?.points ?? []).filter((p) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataKey, shown.length],
  );
  const loadingAt = (i: number) => queries[i]?.isLoading ?? false;

  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds: panes.runIds,
    series: panes.refs,
    sync: {
      cardId: cardOverridesStorageKey(settingsKeyOverride ?? { runId, metricName: metric.name }),
      follow: settings.followSection,
    },
  });
  const { values: sliderValues, safeIdx, currentValue, onSliderChange, stepFor, keyName } = slider;
  const isMulti = shown.length > 1;

  // A series that starts logging after the slider's value shows its first
  // figure rather than nothing (see resolveAtStep's `nearest`).
  const pointAt = useCallback((i: number, value: number): SequencePoint | null => {
    const step = stepFor(i, value, { nearest: true });
    return step == null ? null : resolveAtStep(seriesPoints[i] ?? [], step, { nearest: true });
  }, [stepFor, seriesPoints]);

  const layout = useMediaLayout({ settings, values: sliderValues, currentValue, stepFor, seriesPoints, paneKeys, nearest: true });

  // -------------------------------------------------------------------------
  // Overlay merge (multi-run "overlay" compare mode).
  //
  // Each shown series' figure at the slider's value, its Plotly source
  // fetched through the same `qk.plotlySource` key the panes use (so
  // react-query dedupes the network fetch).
  // -------------------------------------------------------------------------
  const paneCurrents = useMemo(() => {
    if (!isMulti) return [];
    return shown.map((m, idx) => {
      const point = pointAt(idx, currentValue);
      return { m, runId: panes.runIds[idx]!, sourceHash: point ? pointPlotlySource(point) : null, hash: point?.artifact_hash ?? null, point };
    });
  }, [isMulti, shown, pointAt, currentValue, panes.runIds]);

  // Gallery tiles swap steps together (runs side by side never differ).
  const qc = useQueryClient();
  const loaders = useMemo(
    () => ({ prefetchItem: (p: SequencePoint, signal: AbortSignal) => prefetchFigure(qc, p, signal), peekItem: (p: SequencePoint) => peekFigure(qc, p) }),
    [qc],
  );
  const galleryFrames = useSettledGalleries(layout.tiles, loaders);
  useNeighbourPrefetch(settings.panelMode === "gallery" ? sliderValues.length : 0, safeIdx, (j) =>
    shown.flatMap((_, i) => {
      const p = pointAt(i, sliderValues[j]!);
      if (!p?.artifact_hash) return [];
      return [{ key: `figure:${p.artifact_hash}`, run: (signal: AbortSignal) => prefetchPointOrGallery(qc, p, loaders.prefetchItem, signal) }];
    }),
  );

  const overlaySourceQueries = useQueries({
    queries: paneCurrents.map((p) => ({
      ...plotlySourceQuery(p.sourceHash ?? ""),
      enabled: !!p.sourceHash,
    })),
  });

  // Every pane has a resolved Plotly source and its fetch has settled
  // (success or error) — the point at which mergeability can be evaluated
  // instead of transiently reporting "unavailable" while sources load.
  const overlaySourcesSettled =
    paneCurrents.length > 1 &&
    paneCurrents.every((p) => !!p.sourceHash) &&
    overlaySourceQueries.every((q) => q.isSuccess || q.isError);

  const overlayMergeEntries = useMemo<FigureMergeEntry[]>(() => {
    if (!overlaySourcesSettled) return [];
    const entries: FigureMergeEntry[] = [];
    paneCurrents.forEach((p, idx) => {
      const fig = overlaySourceQueries[idx]?.data;
      if (fig) {
        entries.push({
          runId: p.runId,
          runLabel: shortRunLabel(p.runId, allRunIds),
          figure: fig,
          color: runColors.get(p.runId),
        });
      }
    });
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overlaySourcesSettled,
    paneCurrents,
    allRunIds,
    runColors,
    overlaySourceQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  const figureMergeCheck = useMemo(() => {
    if (paneCurrents.length < 2) {
      return { mergeable: false, reason: "need at least 2 series" };
    }
    // Distinguish a permanent gap (some run's current-step figure has no
    // interactive plotly_json source — an artifact-only image, a list) from
    // a transient one (sources are still being fetched), so the
    // settings-panel note doesn't get stuck on "loading…" forever.
    if (!paneCurrents.every((p) => !!p.sourceHash)) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    if (!overlaySourcesSettled) return { mergeable: false, reason: "loading…" };
    if (overlayMergeEntries.length < 2) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    return checkFigureMergeable(overlayMergeEntries.map((e) => e.figure));
  }, [paneCurrents, overlaySourcesSettled, overlayMergeEntries]);

  // Overlay is the gallery's way of showing runs: grid and compare lay out their own tiles.
  const overlayActive =
    isMulti && settings.panelMode === "gallery" && (settings.figureCompare ?? "panes") === "overlay" && figureMergeCheck.mergeable;

  const mergedFigure = useMemo(
    () => (overlayActive ? mergeFigures(overlayMergeEntries) : null),
    [overlayActive, overlayMergeEntries],
  );

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  // Shared view state for syncing zoom/pan/camera across panes and tiles.
  const [sharedView, setSharedView] = useState<SharedView>({});
  const [plotRevision, setPlotRevision] = useState(0);

  // The shared view holds axis ranges captured from *one* figure. Those ranges
  // are meaningless — and can leave the plot area empty, with no error — once
  // the card shows a different figure whose data lies elsewhere on the axis,
  // so drop them whenever the rendered figures change (every tile's plotly
  // source, or its artifact for a gallery, whose manifest names the figures).
  const figureIdentity = useMemo(
    () => layout.tiles.map((t) => (t.point ? pointPlotlySource(t.point) ?? t.point.artifact_hash ?? "" : "")).join("|"),
    [layout.tiles],
  );
  // 3D cameras are kept: a viewpoint applies to the next figure of a series
  // too, so stepping a 3D series holds the angle.
  useEffect(() => {
    setSharedView((prev) => {
      const kept = sceneCameras(prev);
      return Object.keys(kept).length === 0 && Object.keys(prev).length === 0 ? prev : kept;
    });
  }, [figureIdentity]);

  // Live 3D camera sync while a plot is dragged (the shared view above gets
  // the camera when the drag ends).
  const viewLink = useMemo(createViewLink, []);
  const handlePaneRelayout = useCallback((view: SharedView) => {
    // Replace an axis's (or scene's) previous keys with the ones this event
    // carries: a reset (`autorange: true`) and a later zoom (`range[0/1]`) must
    // never coexist, or Plotly resolves the pair to autorange (see
    // `mergeRelayout`).
    // An echo of the current view returns `prev` (no re-render, no loop).
    setSharedView((prev) => mergeRelayout(prev, view));
  }, []);
  // A revision bump gives every plot a fresh `uirevision`, so Plotly drops
  // the user's zoom/pan/camera and falls back to the figure's own view.
  const resetView = useCallback(() => {
    setSharedView({});
    setPlotRevision((r) => r + 1);
  }, []);
  const sync: FigureSync = { settings, viewOverrides: sharedView, onRelayout: handlePaneRelayout, revision: plotRevision, viewLink };

  useRunInfo(allRunIds);

  const subtitle = slider.summary
    ? "summary"
    : sliderValues.length > 0
      ? `${keyName === STEP_KEY ? "step" : keyName} ${formatNum(currentValue)} (${safeIdx + 1}/${sliderValues.length})`
      : `${metric.count} pts`;

  // Measure card width for auto-sizing figure height. cardRef is also the
  // CardShell root (used for scrollIntoView + screenshot export below), so
  // this observes it directly rather than standing up a second observer on
  // a wrapper div — one ResizeObserver per card (see card-kit/index.ts).
  const cardRef = useRef<HTMLDivElement>(null);
  const cardWidth = useElementWidth(cardRef);

  // The card always has a height (its own or the default): figures fill it.
  // Panes of many runs keep a readable row height and scroll instead of
  // squashing into it.
  const cardHeight = resolveCardHeight(settings, FIGURE_POLICY.defaultHeight, FIGURE_MIN_HEIGHT);
  const figRowHeight = useMemo(() => {
    if (!isMulti || cardWidth <= 0) return undefined;
    const n = shown.length;
    const minPaneW = 200;
    const cols = Math.min(n, Math.max(1, Math.floor(cardWidth / minPaneW)));
    const rows = Math.ceil(n / cols);
    const minRowH = 150;
    // Header, slider and gaps take about this much of the card.
    if (cardHeight == null || rows * minRowH <= cardHeight - 120) return undefined;
    // 4:3 landscape ratio per row
    const rowH = Math.max(minRowH, Math.min(400, Math.round((cardWidth / cols) * 0.75)));
    return `${rowH}px`;
  }, [cardHeight, cardWidth, shown.length, isMulti]);

  const placeholder = (i: number) =>
    loadingAt(i)
      ? <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      : <div className="text-sm text-fg-muted">no figure logged yet</div>;

  /** One tile: a run's figure at the tile's value, or the list items it shows. */
  const renderTile = (tile: LayoutTile, single: boolean, inModal: boolean) => {
    const { point, run } = tile;
    if (!point?.artifact_hash) return placeholder(Math.max(0, run));
    const name = shown[run]?.name ?? metric.name;
    const fill = single ? (inModal ? "h-[calc(100vh-12rem)]" : "flex-1 min-h-0") : "h-full";
    if (isGalleryPoint(point)) {
      return (
        <div className={`${fill} overflow-auto`}>
          <FigureGallery point={point} frame={galleryFrames?.get(tile.id)} name={name} sync={sync} indices={tile.items ?? undefined} />
        </div>
      );
    }
    return (
      <ArtifactMark hash={point.artifact_hash} name={name} step={point.step} mime={point.artifact_mime ?? "image/png"}>
        <FigureViewer
          source={figureSource(point)}
          label={`${name} @ step ${point.step}`}
          sync={sync}
          className={single ? `rounded bg-bg ${fill}` : undefined}
        />
      </ArtifactMark>
    );
  };

  // The gallery's Run content: one pane per run in the card's resizable pane grid.
  const renderPanes = (tiles: readonly LayoutTile[], inModal: boolean) => {
    if (tiles.length <= 1) return tiles[0] ? renderTile(tiles[0], true, inModal) : placeholder(0);
    return (
      <MultiPaneGrid
        rowHeight={figRowHeight}
        columns={settings.columns}
        paneKeys={tiles.map((t) => paneKeys[t.run]!)}
        labels={panes.labels}
        colors={panes.paneColors}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => ctl.set({ paneWidths: w })}
        renderPane={(_key, k) => renderTile(tiles[k]!, false, inModal)}
      />
    );
  };

  // Single merged plot for the "overlay" compare mode — every run's traces
  // in one figure, layout from the first run with fixed ranges dropped (see
  // mergeFigures/checkFigureMergeable in lib/plot-utils/figure-merge).
  const renderOverlayPlot = () => (
    <>
      {/* The overlaid figures, for the header's download. */}
      {paneCurrents.map((p, i) => (
        <ArtifactMark key={i} hash={p.hash} name={p.m.name} step={p.point?.step} mime={p.point?.artifact_mime ?? "image/png"}>{null}</ArtifactMark>
      ))}
      <InteractiveFigure
        figure={mergedFigure ?? EMPTY_FIGURE}
        settings={settings}
        viewOverrides={sharedView}
        onRelayout={handlePaneRelayout}
        revision={plotRevision}
      />
    </>
  );

  const paneOptions = useMemo(
    () => paneKeys.map((k, i) => ({
      key: k,
      label: panes.labels.get(k) ?? shown[i]!.name,
      color: panes.multiRun ? panes.colors.get(panes.runIds[i]!) : undefined,
    })),
    [paneKeys, panes, shown],
  );

  const renderTiles = (inModal: boolean) => (
    <MediaTiles
      layout={layout}
      settings={settings}
      update={ctl.set}
      panes={paneOptions}
      multiRun={panes.multiRun}
      keyName={keyName}
      values={sliderValues}
      currentValue={currentValue}
      onValue={slider.setValue}
      inModal={inModal}
      gridRowHeight={180}
      renderTile={(tile, { single }) => renderTile(tile, single, inModal)}
      renderPanes={(tiles) => renderPanes(tiles, inModal)}
    />
  );

  const renderContent = (inModal: boolean) => (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {overlayActive ? renderOverlayPlot() : renderTiles(inModal)}
      </div>
      <StepSlider
        points={slider.sliderPoints}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        keyName={keyName}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => ctl.set({ xAxis: m })}
        className="mt-3"
      />
      {allMetrics.length > 1 && (
        <SeriesChipStrip
          metrics={allMetrics}
          controlledSeries={controlledSeries}
          runId={runId}
          allRunIds={allRunIds}
          onMetricsChange={(next) => ctl.set({ metrics: next })}
        />
      )}
    </>
  );

  const settingsPanel = (
    <FigureSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        multi: panes.visibleCount > 1,
        merge: figureMergeCheck,
        scalarMetrics,
        following: slider.sync != null,
        paneKeys,
        lists: layout.lists,
        listCount: layout.listCount,
        sliderValue: currentValue,
      }}
    />
  );

  return (
    <CardShell cardKind="figure"
      cardRef={cardRef}
      settings={settings}
      updateSettings={ctl.set}
      title={metric.name}
      subtitle={subtitle}
      subtitleCollapsedOnly={sliderValues.length > 1}
      defaultHeight={FIGURE_POLICY.defaultHeight}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onResetView={resetView}
      headerActions={<>
        <button
          type="button"
          onClick={() => ctl.set({ displayModeBar: !settings.displayModeBar })}
          aria-label={settings.displayModeBar ? "Hide modebar" : "Show modebar"}
          aria-pressed={settings.displayModeBar}
          title={settings.displayModeBar ? "Hide modebar" : "Show modebar"}
          className={`h-5 touch:h-10 touch:min-w-[40px] inline-flex items-center justify-center rounded px-1.5 text-[10px] hover:bg-bg-hover text-fg-muted hover:text-fg${
            settings.displayModeBar ? " text-accent" : ""
          }`}
        >
          bar
        </button>
      </>}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-full flex-col">{renderContent(true)}</div>}
    >
      {renderContent(false)}
    </CardShell>
  );
}
