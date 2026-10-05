import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import ArtifactMark from "./media/ArtifactMark";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { hashSource } from "../lib/viewers/source";
import { safeJsonParse } from "../lib/format";
import { cardOverridesStorageKey, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { useRunMetadataVersion, shortRunLabel } from "../lib/run-label";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import type { SequenceMeta, SequencePoint, SequenceResponse } from "../api/types";
import GalleryView, { useSettledGalleries } from "./media/GalleryView";
import type { GalleryFrame } from "../lib/media/gallery-query";
import { isGalleryPoint } from "../lib/media/gallery";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid } from "./card-kit";
import {
  instanceDefaults,
  type FigureSettings,
} from "./cards-settings/figure";
import { checkFigureMergeable, mergeFigures, type FigureMergeEntry } from "../lib/plot-utils/figure-merge";
import { mergeRelayout, sceneCameras, type SharedView } from "../lib/plot-utils/view-overrides";
import { createCameraLink, type CameraLink } from "../lib/plot-utils/scene3d";
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

/** A gallery point's figures in a grid filling the pane, swapped as a whole per step. */
function FigureGallery({ point, frame, name, sync }: { point: SequencePoint; frame?: GalleryFrame; name: string; sync: FigureSync }) {
  const qc = useQueryClient();
  return (
    <GalleryView
      point={point}
      frame={frame}
      fill
      minItemHeight={180}
      prefetchItem={(p, signal) => prefetchFigure(qc, p, signal)}
      peekItem={(p) => peekFigure(qc, p)}
      renderItem={(item, i) => <FigureViewer source={figureSource(item)} label={`${name} @ step ${item.step} #${i}`} sync={sync} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Single pane: renders one figure at the given global step number.
// ---------------------------------------------------------------------------
function FigurePane({
  runId,
  m,
  targetStep,
  settings,
  viewOverrides,
  onRelayout,
  revision,
  cameraLink,
  galleryFrame,
}: {
  /** This pane's gallery frame, settled by the card with every other pane's. */
  galleryFrame?: GalleryFrame;
  runId: string;
  m: { runId?: string; name: string };
  /** The pane's step (per run for a slider key); null shows the empty state. */
  targetStep: number | null;
  settings: FigureSettings;
  viewOverrides?: SharedView;
  onRelayout?: (view: SharedView) => void;
  revision?: number;
  cameraLink?: CameraLink;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name);
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  // Find the point at or closest below the target step.
  const current = useMemo(
    () => (targetStep == null ? null : resolveAtStep(points, targetStep)),
    [points, targetStep],
  );

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no figure logged yet</div>;
  }
  const sync = { settings, viewOverrides, onRelayout, revision, cameraLink };
  if (isGalleryPoint(current)) {
    return (
      <div className="h-full overflow-auto">
        <FigureGallery point={current} frame={galleryFrame} name={m.name} sync={sync} />
      </div>
    );
  }
  return (
    <ArtifactMark hash={current.artifact_hash} name={m.name} step={current.step} mime={current.artifact_mime ?? "image/png"}>
      <FigureViewer source={figureSource(current)} label={`${m.name} @ step ${current.step}`} sync={sync} />
    </ArtifactMark>
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
  const effectiveMetrics = panes.shown;
  const multipleRuns = panes.multiRun;
  const runColors = panes.colors;
  const scalarMetrics = useScalarMetricNames(runId);

  // For the single-metric path, fetch points to drive the step slider.
  const q = useSequence(runId, metric.name);
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // For multi-metric, fetch all sequences to determine max step count.
  const multiQueries = useQueries({
    queries: effectiveMetrics.length > 1
      ? effectiveMetrics.map((m) => {
          const rid = m.runId ?? runId;
          return {
            queryKey: qk.sequence(rid, m.name),
            queryFn: () =>
              api.sequence(rid, m.name),
            refetchInterval: 2_000,
            staleTime: 2_000,
          };
        })
      : [],
  });

  // Points per series feeding the step slider: single-metric primary plus any
  // extra multi-metric series (all pre-filtered to points with an artifact).
  const seriesPoints = useMemo(() => {
    const arr: Array<Array<{ step: number }>> = [points];
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        arr.push(pts.filter((p) => p.artifact_hash));
      }
    }
    return arr;
  }, [effectiveMetrics.length, points, multiQueries]);

  // seriesPoints[0] is the card's own series; pane i is seriesPoints[i + 1].
  const seriesRunIds = useMemo(
    () => [runId, ...(effectiveMetrics.length > 1 ? effectiveMetrics.map((m) => m.runId ?? runId) : [])],
    [runId, effectiveMetrics],
  );
  const slider = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings: ctl.set,
    sliderKey: settings.sliderKey,
    seriesRunIds,
    sync: {
      cardId: cardOverridesStorageKey(settingsKeyOverride ?? { runId, metricName: metric.name }),
      follow: settings.followSection,
    },
  });
  const { values: sliderValues, safeIdx, currentStep, currentValue, onSliderChange, stepFor } = slider;
  // For the single-metric path, find the point at the current global step.
  // Falls back to the most recent point at-or-before the step (and, failing
  // that, the first point) instead of an exact-match `.find` — `currentStep`
  // comes from `useStepSlider`'s *global* step union, which in a multi-series
  // card can legitimately include steps this series has no exact point for.
  // Every other per-step card (TableCard, HistogramCard, TensorCard, etc.)
  // already uses this `resolveAtStep(...) ?? points[0]` pattern; matching it
  // here keeps this card from going blank instead of showing the last-good
  // figure.
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );

  // -------------------------------------------------------------------------
  // Overlay merge (multi-run "overlay" compare mode).
  //
  // For each effective metric, resolve the Plotly source at the *current*
  // step (reusing multiQueries' already-fetched sequence points, which are
  // in the same order as effectiveMetrics) and fetch its plotly-source JSON
  // via the same `qk.plotlySource` query key FigurePane uses, so react-query
  // dedupes the network fetch when panes mode is also mounted.
  // -------------------------------------------------------------------------
  const paneCurrents = useMemo(() => {
    if (effectiveMetrics.length <= 1) return [];
    return effectiveMetrics.map((m, idx) => {
      const rid = m.runId ?? runId;
      const pts = (multiQueries[idx]?.data as SequenceResponse | undefined)?.points ?? [];
      const filtered = pts.filter((p) => p.artifact_hash);
      const paneStep = stepFor(idx + 1);
      const paneCurrent = paneStep == null ? null : resolveAtStep(filtered, paneStep);
      const paneSourceHash = paneCurrent ? pointPlotlySource(paneCurrent) : null;
      return { m, runId: rid, sourceHash: paneSourceHash, hash: paneCurrent?.artifact_hash ?? null, point: paneCurrent };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveMetrics,
    stepFor,
    runId,
    multiQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  // Gallery panes swap steps together (runs side by side never differ).
  const qcFig = useQueryClient();
  const paneGalleries = useSettledGalleries(
    paneCurrents.map((p, i) => ({ id: String(i), point: p.point })),
    { prefetchItem: (p, signal) => prefetchFigure(qcFig, p, signal), peekItem: (p) => peekFigure(qcFig, p) },
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
    // interactive plotly_json source — e.g. an artifact-only image) from a
    // transient one (sources are still being fetched), so the settings-panel
    // note doesn't get stuck on "loading…" forever.
    if (!paneCurrents.every((p) => !!p.sourceHash)) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    if (!overlaySourcesSettled) return { mergeable: false, reason: "loading…" };
    if (overlayMergeEntries.length < 2) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    return checkFigureMergeable(overlayMergeEntries.map((e) => e.figure));
  }, [paneCurrents, overlaySourcesSettled, overlayMergeEntries]);

  // (effectiveMetrics.length > 1, i.e. `isMulti` below — spelled out here
  // since `isMulti` isn't declared until later in this component.)
  const overlayActive =
    effectiveMetrics.length > 1 &&
    (settings.figureCompare ?? "panes") === "overlay" &&
    figureMergeCheck.mergeable;

  const mergedFigure = useMemo(
    () => (overlayActive ? mergeFigures(overlayMergeEntries) : null),
    [overlayActive, overlayMergeEntries],
  );

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);



  // Single-metric path: the current figure's Plotly source (its identity below).
  const sourceHash = current ? pointPlotlySource(current) : null;

  // Shared view state for syncing zoom/pan/camera across comparison panes.
  // Also used in single-pane mode to track whether zoom has been modified.
  const [sharedView, setSharedView] = useState<SharedView>({});
  const [plotRevision, setPlotRevision] = useState(0);

  // The shared view holds axis ranges captured from *one* figure. Those ranges
  // are meaningless — and can leave the plot area empty, with no error — once
  // the card shows a different figure whose data lies elsewhere on the axis,
  // so drop them whenever the rendered figure's identity changes (the single
  // pane's plotly source hash plus every multi-pane one).
  const figureIdentity = useMemo(
    // (A gallery has no source of its own: its manifest names the figures.)
    () => [sourceHash ?? current?.artifact_hash ?? "", ...paneCurrents.map((p) => p.sourceHash ?? p.hash ?? "")].join("|"),
    [sourceHash, current?.artifact_hash, paneCurrents],
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
  const cameraLink = useMemo(createCameraLink, []);
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

  useRunInfo(allRunIds);

  // Re-render when run metadata cache is populated so labels update.
  const runMetaVersion = useRunMetadataVersion();

  const subtitle =
    sliderValues.length > 0
      ? `${slider.keyName === "step" ? "step" : slider.keyName} ${formatNum(currentValue)} (${safeIdx + 1}/${sliderValues.length})`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const figContainerRef = useRef<HTMLDivElement | null>(null);

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
    const n = effectiveMetrics.length;
    const minPaneW = 200;
    const cols = Math.min(n, Math.max(1, Math.floor(cardWidth / minPaneW)));
    const rows = Math.ceil(n / cols);
    const minRowH = 150;
    // Header, slider and gaps take about this much of the card.
    if (cardHeight == null || rows * minRowH <= cardHeight - 120) return undefined;
    // 4:3 landscape ratio per row
    const rowH = Math.max(minRowH, Math.min(400, Math.round((cardWidth / cols) * 0.75)));
    return `${rowH}px`;
  }, [cardHeight, cardWidth, effectiveMetrics.length, isMulti]);

  const renderSingleFigure = (heightClass: string) => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no figure logged yet</div>;
    }
    return (
      <>
        {isGalleryPoint(current) ? (
          <div className={`${heightClass} overflow-auto`}>
            <FigureGallery
              point={current}
              name={metric.name}
              sync={{ settings, viewOverrides: sharedView, onRelayout: handlePaneRelayout, revision: plotRevision, cameraLink }}
            />
          </div>
        ) : (
          <ArtifactMark hash={current.artifact_hash} name={metric.name} step={current.step} mime={current.artifact_mime ?? "image/png"}>
            <FigureViewer
              source={figureSource(current)}
              label={`${metric.name} @ step ${current.step}`}
              sync={{ settings, viewOverrides: sharedView, onRelayout: handlePaneRelayout, revision: plotRevision, cameraLink }}
              className={`rounded bg-bg ${heightClass}`}
            />
          </ArtifactMark>
        )}
        <StepSlider
          points={slider.sliderPoints}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          keyName={slider.keyName}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => ctl.set({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        map.set(seriesKey(m), seriesLabel(m.name, m.runId ?? runId, true, allRunIds));
      }
    }
    return map;
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const paneColors = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        const c = runColors.get(m.runId ?? runId);
        if (c) map.set(seriesKey(m), c);
      }
    }
    return map;
  }, [multipleRuns, effectiveMetrics, runColors, runId]);

  const renderPaneGrid = (inModal: boolean) => (
    <MultiPaneGrid
      rowHeight={figRowHeight}
      columns={settings.columns}
      paneKeys={paneKeys}
      labels={paneLabels}
      colors={paneColors}
      inModal={inModal}
      paneWidths={settings.paneWidths}
      onPaneWidthsChange={(w) => ctl.set({ paneWidths: w })}
      renderPane={(key, i) => {
        const m = effectiveMetrics[i]!;
        return (
          <FigurePane
            key={key}
            runId={runId}
            m={m}
            targetStep={stepFor(i + 1)}
            settings={settings}
            viewOverrides={sharedView}
            onRelayout={handlePaneRelayout}
            revision={plotRevision}
            cameraLink={cameraLink}
            galleryFrame={paneGalleries?.get(String(i))}
          />
        );
      }}
    />
  );

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

  const renderMultiFigure = (inModal: boolean) => (
    <>
      {inModal ? (
        overlayActive ? renderOverlayPlot() : renderPaneGrid(true)
      ) : (
        <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto">
          {overlayActive ? renderOverlayPlot() : renderPaneGrid(false)}
        </div>
      )}
      <StepSlider
        points={slider.sliderPoints}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        keyName={slider.keyName}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => ctl.set({ xAxis: m })}
        className="mt-3"
      />
      <SeriesChipStrip
        metrics={allMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => ctl.set({ metrics: next })}
      />
    </>
  );

  const renderContent = (inModal: boolean) => {
    if (isMulti) return renderMultiFigure(inModal);
    return renderSingleFigure(inModal ? "h-[calc(100vh-12rem)]" : "flex-1 min-h-0");
  };


  const settingsPanel = (
    <FigureSettingsPanel
      ctl={ctl}
      mode="card"
      ctx={{
        multi: isMulti,
        merge: figureMergeCheck,
        scalarMetrics,
        following: slider.sync != null,
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
      modalContent={renderContent(true)}
    >
      <>
      {renderContent(false)}
      </>
    </CardShell>
  );
}
