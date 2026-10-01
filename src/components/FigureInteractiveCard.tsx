import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { keepPreviousData, useQuery, useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import SettledImg from "./media/SettledImg";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename, exportPlotlyChart, safeName } from "../lib/download";
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
import { decodeImage, peekDecoded } from "../lib/media/decoded-image";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid } from "./card-kit";
import {
  instanceDefaults,
  type FigureSettings,
} from "./cards-settings/figure";
import { checkFigureMergeable, mergeFigures, type FigureMergeEntry } from "../lib/plot-utils/figure-merge";
import {
  applyViewOverrides,
  extractViewState,
  mergeRelayout,
  sceneCameras,
  type SharedView,
} from "../lib/plot-utils/view-overrides";
import { toWebGL } from "../lib/plot-utils/webgl";
import type { PlotlyFigureLike } from "../lib/plot-utils/types";
import PlotlyChart from "../charts/PlotlyChart";
import { readChartTheme, type ChartTheme } from "../charts/theme";
import AddToReportButton from "./AddToReportButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import { useMediaPanes, useScalarMetricNames } from "./card-kit/use-media-panes";
import FigureSettingsPanel from "./settings-panels/FigureSettingsPanel";
import StepSlider from "./StepSlider";
import { formatKeyValue } from "../lib/media/slider-key";
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

interface FigureMetadata {
  has_source?: boolean;
  source_format?: string | null;
  source_hash?: string | null;
}

type PlotlyFigure = PlotlyFigureLike;


const EMPTY_FIGURE: PlotlyFigure = { data: [], layout: {} };

const plotlySourceQuery = (sourceHash: string) => ({
  queryKey: qk.plotlySource(sourceHash),
  queryFn: async (): Promise<PlotlyFigure> => {
    const res = await fetch(api.artifactUrl(sourceHash));
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return (await res.json()) as PlotlyFigure;
  },
  // Content addressed: never stale.
  staleTime: Infinity,
  retry: false,
});

function usePlotlySource(sourceHash: string | null | undefined) {
  return useQuery({
    ...plotlySourceQuery(sourceHash ?? ""),
    enabled: !!sourceHash,
    // The previous step's figure stays on screen while the next one loads
    // (no placeholder flash).
    placeholderData: keepPreviousData,
  });
}

/** The point's interactive Plotly source, when it has one. */
function plotlySourceHash(point: SequencePoint): string | null {
  const meta = safeJsonParse<FigureMetadata>(point.artifact_metadata ?? null);
  return meta?.has_source && meta.source_format === "plotly_json" ? meta.source_hash ?? null : null;
}

/** Warm one figure: its Plotly source, or its PNG decoded. */
function prefetchFigure(qc: QueryClient, point: SequencePoint, signal: AbortSignal): Promise<unknown> {
  const source = plotlySourceHash(point);
  return source ? qc.prefetchQuery(plotlySourceQuery(source)) : decodeImage(api.artifactUrl(point.artifact_hash!), signal);
}

function peekFigure(qc: QueryClient, point: SequencePoint): boolean {
  const source = plotlySourceHash(point);
  return source ? qc.getQueryData(qk.plotlySource(source)) !== undefined : !!peekDecoded(api.artifactUrl(point.artifact_hash!));
}

// ---------------------------------------------------------------------------
// User figure renderer.
// ---------------------------------------------------------------------------

/** Shallow-merge `defaults` UNDER `authored` — the figure author's keys win. */
function under(authored: unknown, defaults: Record<string, unknown>): Record<string, unknown> {
  return { ...defaults, ...((authored ?? {}) as Record<string, unknown>) };
}

/**
 * The author's layout with app-theme colours filled in underneath: the
 * figure's backgrounds are transparent so it sits on the card, which means
 * every foreground colour must come from the app theme too. Fixed
 * width/height are dropped so the figure fills its pane.
 */
function themeFigureLayout(base: Record<string, unknown>, t: ChartTheme): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  out.paper_bgcolor = base.paper_bgcolor ?? "transparent";
  out.plot_bgcolor = base.plot_bgcolor ?? "transparent";
  delete out.width;
  delete out.height;
  out.font = under(base.font, { color: t.fg });
  const axis = { gridcolor: t.grid, zerolinecolor: t.grid, linecolor: t.grid };
  const axisKeys = new Set(["xaxis", "yaxis"]);
  for (const k of Object.keys(base)) if (/^[xyz]axis\d*$/.test(k)) axisKeys.add(k);
  for (const k of axisKeys) out[k] = under(base[k], axis);
  if (base.scene != null) {
    const scene = { ...(base.scene as Record<string, unknown>) };
    for (const k of ["xaxis", "yaxis", "zaxis"]) {
      scene[k] = under(scene[k], { ...axis, backgroundcolor: "transparent", showbackground: false });
    }
    out.scene = scene;
  }
  out.legend = under(base.legend, { bgcolor: "transparent", bordercolor: t.grid });
  // Hover labels float over the data, so they must be opaque.
  out.hoverlabel = under(base.hoverlabel, {
    bgcolor: t.bg,
    bordercolor: t.grid,
    font: under((base.hoverlabel as Record<string, unknown> | undefined)?.font, { color: t.fg }),
  });
  out.modebar = under(base.modebar, { bgcolor: "transparent", color: t.fgMuted, activecolor: t.fg });
  return out;
}

// A new figure object (a different artifact) gets a fresh `uirevision`, so
// Plotly drops the previous figure's zoom instead of carrying it over.
const figureIds = new WeakMap<object, number>();
let nextFigureId = 0;
function figureId(fig: object): number {
  let id = figureIds.get(fig);
  if (id === undefined) figureIds.set(fig, (id = nextFigureId++));
  return id;
}

/**
 * One user Plotly figure, styled by the interaction settings, with the
 * shared view (zoom/pan/camera synced across panes) applied on top.
 * `revision` bumps reset the view to the figure's own. Scatter traces draw
 * with WebGL per the card's `webgl` setting (the stored figure unchanged).
 * `fallbackSrc` (the stored PNG) stands in while the plot is paused by the
 * page's WebGL budget and no live snapshot of it exists yet.
 */
function InteractiveFigure({
  figure,
  settings,
  viewOverrides,
  onRelayout,
  revision = 0,
  className,
  style,
  liveRelayout,
  fallbackSrc,
}: {
  figure: PlotlyFigure;
  fallbackSrc?: string;
  settings: FigureSettings;
  viewOverrides?: SharedView;
  onRelayout?: (view: SharedView) => void;
  revision?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Also sync on `plotly_relayouting` (fires continuously during a 3D camera drag). */
  liveRelayout?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { hoverMode, dragMode, showLegend, displayModeBar, scrollZoom, webgl } = settings;
  const data = useMemo(
    () => toWebGL((figure.data ?? []) as Array<Record<string, unknown>>, figure.layout as Record<string, unknown> | undefined, webgl ?? "auto").data,
    [figure, webgl],
  );

  const layout = useMemo(() => {
    // Deep copy: Plotly writes zoom ranges into the layout's arrays in place,
    // and `figure` is the react-query-cached artifact shared by every pane.
    const authored = structuredClone((figure.layout ?? {}) as Record<string, unknown>);
    const themed = themeFigureLayout(authored, readChartTheme(document.documentElement));
    themed.hovermode = hoverMode === "none" ? false : hoverMode;
    themed.dragmode = dragMode === "none" ? false : dragMode;
    themed.showlegend = showLegend;
    themed.uirevision = `${figureId(figure)}:${revision}`;
    return viewOverrides && Object.keys(viewOverrides).length > 0 ? applyViewOverrides(themed, viewOverrides) : themed;
  }, [figure, hoverMode, dragMode, showLegend, revision, viewOverrides]);

  const config = useMemo(() => ({ displayModeBar, scrollZoom }), [displayModeBar, scrollZoom]);

  const handleRelayout = useCallback((e: Record<string, unknown>) => {
    const view = onRelayout && extractViewState(e);
    if (view) onRelayout!(view);
  }, [onRelayout]);

  // PlotlyChart creates the plot asynchronously, so re-check every render.
  useEffect(() => {
    if (!liveRelayout || !onRelayout) return;
    const el = hostRef.current?.querySelector(".js-plotly-plot") as
      | (HTMLElement & { on?: (ev: string, fn: (e: Record<string, unknown>) => void) => void; removeAllListeners?: (ev: string) => void })
      | null;
    if (!el?.on) return;
    el.on("plotly_relayouting", handleRelayout);
    return () => el.removeAllListeners?.("plotly_relayouting");
  });

  return (
    <div ref={hostRef} className={className ?? "rounded bg-bg h-full"} style={style}>
      <PlotlyChart
        data={data}
        layout={layout}
        fallbackSrc={fallbackSrc}
        config={config}
        themed={false}
        onRelayout={handleRelayout}
      />
    </div>
  );
}

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

/** Shared view (zoom/pan/camera) wiring, handed down to every figure. */
interface ViewSync {
  settings: FigureSettings;
  viewOverrides?: SharedView;
  onRelayout?: (view: SharedView) => void;
  revision?: number;
}

/** One figure: interactive from its Plotly source, else its PNG. */
function FigureItem({ point, label, sync }: { point: SequencePoint; label: string; sync: ViewSync }) {
  const sourceHash = plotlySourceHash(point);
  const sourceQ = usePlotlySource(sourceHash);
  if (sourceHash && sourceQ.isSuccess && sourceQ.data?.data) {
    return (
      <InteractiveFigure
        figure={sourceQ.data}
        settings={sync.settings}
        viewOverrides={sync.viewOverrides}
        onRelayout={sync.onRelayout}
        revision={sync.revision}
        liveRelayout
        fallbackSrc={api.artifactUrl(point.artifact_hash!)}
      />
    );
  }
  if (sourceHash && sourceQ.isLoading) {
    return <div className="h-full min-h-[8rem] motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="flex h-full justify-center items-center rounded bg-bg p-2 overflow-hidden">
      <SettledImg
        src={api.artifactUrl(point.artifact_hash!)}
        alt={label}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

/** A gallery point's figures in a grid filling the pane, swapped as a whole per step. */
function FigureGallery({ point, frame, name, sync }: { point: SequencePoint; frame?: GalleryFrame; name: string; sync: ViewSync }) {
  const qc = useQueryClient();
  return (
    <GalleryView
      point={point}
      frame={frame}
      fill
      minItemHeight={180}
      prefetchItem={(p, signal) => prefetchFigure(qc, p, signal)}
      peekItem={(p) => peekFigure(qc, p)}
      renderItem={(item, i) => <FigureItem point={item} label={`${name} @ step ${item.step} #${i}`} sync={sync} />}
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

  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no figure logged yet</div>;
  }
  if (isGalleryPoint(current)) {
    return (
      <div className="h-full overflow-auto">
        <FigureGallery point={current} frame={galleryFrame} name={m.name} sync={{ settings, viewOverrides, onRelayout, revision }} />
      </div>
    );
  }
  if (showPlotly) {
    return (
      <InteractiveFigure
        figure={sourceQ.data!}
        settings={settings}
        viewOverrides={viewOverrides}
        onRelayout={onRelayout}
        revision={revision}
        liveRelayout
        fallbackSrc={api.artifactUrl(current.artifact_hash)}
      />
    );
  }
  if (sourceHash && sourceQ.isLoading) {
    return <div className="h-full min-h-[12rem] motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="flex h-full justify-center items-center rounded bg-bg p-2 overflow-hidden">
      <SettledImg
        src={api.artifactUrl(current.artifact_hash)}
        alt={`${m.name} @ step ${current.step}`}
        className="max-h-full max-w-full object-contain"
      />
    </div>
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
      const paneMeta = safeJsonParse<FigureMetadata>(paneCurrent?.artifact_metadata ?? null);
      const paneSourceHash =
        paneMeta?.has_source && paneMeta?.source_format === "plotly_json"
          ? paneMeta.source_hash ?? null
          : null;
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
      queryKey: qk.plotlySource(p.sourceHash),
      queryFn: async (): Promise<PlotlyFigure> => {
        const res = await fetch(api.artifactUrl(p.sourceHash as string));
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()) as PlotlyFigure;
      },
      enabled: !!p.sourceHash,
      staleTime: 60_000,
      retry: false,
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

  const compSeries = useMemo(
    () => [{ runId, name: metric.name }],
    [runId, metric.name],
  );


  // Single-metric path: Plotly source for the current figure.
  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

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

  const viewModified = Object.keys(sharedView).length > 0;
  const updatingRef = useRef(false);
  const handlePaneRelayout = useCallback((view: SharedView) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    // Replace an axis's (or scene's) previous keys with the ones this event
    // carries: a reset (`autorange: true`) and a later zoom (`range[0/1]`) must
    // never coexist, or Plotly resolves the pair to autorange (see
    // `mergeRelayout`).
    setSharedView((prev) => mergeRelayout(prev, view));
    requestAnimationFrame(() => { updatingRef.current = false; });
  }, []);
  // A revision bump gives every plot a fresh `uirevision`, so Plotly drops
  // the user's zoom/pan/camera and falls back to the figure's own view.
  const resetView = useCallback(() => {
    setSharedView({});
    setPlotRevision((r) => r + 1);
  }, []);

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;

  useRunInfo(allRunIds);

  // Re-render when run metadata cache is populated so labels update.
  const runMetaVersion = useRunMetadataVersion();

  const subtitle =
    sliderValues.length > 0
      ? `${slider.keyName === "step" ? "step" : slider.keyName} ${formatKeyValue(currentValue)} (${safeIdx + 1}/${sliderValues.length})`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const figContainerRef = useRef<HTMLDivElement | null>(null);

  // Measure card width for auto-sizing figure height. cardRef is also the
  // CardShell root (used for scrollIntoView + screenshot export below), so
  // this observes it directly rather than standing up a second observer on
  // a wrapper div — one ResizeObserver per card (see card-kit/index.ts).
  const cardRef = useRef<HTMLDivElement>(null);
  const cardWidth = useElementWidth(cardRef);

  // Auto-height for figure containers
  const { figAutoHeight, figRowHeight } = useMemo(() => {
    if (resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null) return { figAutoHeight: undefined, figRowHeight: undefined };
    if (cardWidth <= 0) return { figAutoHeight: "320px", figRowHeight: undefined };
    if (!isMulti) {
      const h = Math.max(200, Math.min(500, Math.round(cardWidth * 0.75)));
      return { figAutoHeight: `${h}px`, figRowHeight: undefined };
    }
    const n = effectiveMetrics.length;
    const minPaneW = 200;
    const cols = Math.min(n, Math.max(1, Math.floor(cardWidth / minPaneW)));
    const rows = Math.ceil(n / cols);
    const paneW = cardWidth / cols;
    // 4:3 landscape ratio per row
    const rowH = Math.max(150, Math.min(400, Math.round(paneW * 0.75)));
    const total = Math.min(800, rows * rowH);
    return { figAutoHeight: `${total}px`, figRowHeight: `${rowH}px` };
  }, [settings.height, settings.colSpan, cardWidth, effectiveMetrics.length, isMulti]);

  const renderSingleFigure = (heightClass: string, heightStyle?: React.CSSProperties) => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no figure logged yet</div>;
    }
    return (
      <>
        {isGalleryPoint(current) ? (
          <div className={`${heightClass} overflow-auto`} style={heightStyle}>
            <FigureGallery
              point={current}
              name={metric.name}
              sync={{ settings, viewOverrides: sharedView, onRelayout: handlePaneRelayout, revision: plotRevision }}
            />
          </div>
        ) : showPlotly ? (
          <InteractiveFigure
            figure={sourceQ.data!}
            settings={settings}
            viewOverrides={sharedView}
            onRelayout={handlePaneRelayout}
            revision={plotRevision}
            fallbackSrc={api.artifactUrl(current.artifact_hash)}
            className={`rounded bg-bg ${heightClass}`}
            style={heightStyle}
          />
        ) : sourceHash && sourceQ.isLoading ? (
          <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
        ) : (
          <div className={`flex justify-center items-center rounded bg-bg p-2 ${heightClass}`}>
            <SettledImg
              src={api.artifactUrl(current.artifact_hash)}
              alt={`${metric.name} @ step ${current.step}`}
              className="max-w-full max-h-full object-contain"
            />
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

  const renderPaneGrid = (inModal: boolean) => (
    <MultiPaneGrid
      rowHeight={figRowHeight}
      columns={settings.columns}
      paneKeys={paneKeys}
      labels={paneLabels}
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
    <InteractiveFigure
      figure={mergedFigure ?? EMPTY_FIGURE}
      settings={settings}
      viewOverrides={sharedView}
      onRelayout={handlePaneRelayout}
      revision={plotRevision}
    />
  );

  const renderMultiFigure = (inModal: boolean) => (
    <>
      {inModal ? (
        overlayActive ? renderOverlayPlot() : renderPaneGrid(true)
      ) : (
        <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto" style={{ height: resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null ? undefined : figAutoHeight }}>
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
    return renderSingleFigure(
      inModal ? "h-[calc(100vh-12rem)]" : "flex-1 min-h-0",
      inModal ? undefined : { height: resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null ? undefined : figAutoHeight },
    );
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
      defaultHeight={FIGURE_POLICY.defaultHeight}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "image/png")) : undefined}
      onScreenshot={() => { if (cardRef.current) exportPlotlyChart(cardRef.current, safeName(settings.title ?? metric.name), "png"); }}
      addToReportSlot={<AddToReportButton cardType="figure" series={compSeries} settingsKey={settingsKeyOverride ?? { runId, metricName: metric.name }} />}
      onResetView={resetView}
      viewModified={viewModified}
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
