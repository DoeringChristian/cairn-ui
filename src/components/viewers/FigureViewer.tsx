/**
 * The figure viewer every surface shares: a Plotly figure (a logged
 * `cairn.Figure` with an interactive source, or a Plotly JSON file) drawn
 * through PlotlyChart (themed, WebGL per the page's budget), else the
 * figure's stored PNG in the image viewer.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequencePoint } from "../../api/types";
import { safeJsonParse } from "../../lib/format";
import { decodeImage, peekDecoded } from "../../lib/media/decoded-image";
import { applyViewOverrides, extractViewState, type SharedView } from "../../lib/plot-utils/view-overrides";
import { toWebGL } from "../../lib/plot-utils/webgl";
import { scene3dLayout, type ViewFollower, type ViewLink } from "../../lib/plot-utils/scene3d";
import type { PlotlyFigureLike } from "../../lib/plot-utils/types";
import type { ViewerSource } from "../../lib/viewers/source";
import PlotlyChart, { showAxisRanges, showSceneCamera } from "../../charts/PlotlyChart";
import { readChartTheme, type ChartTheme } from "../../charts/theme";
import { builtin as FIGURE_DEFAULTS, type FigureSettings } from "../cards-settings/figure";
import ImageViewer from "./ImageViewer";

/** What the SDK records with a logged figure. */
export interface FigureMetadata {
  has_source?: boolean;
  source_format?: string | null;
  source_hash?: string | null;
}

export type PlotlyFigure = PlotlyFigureLike;

export const plotlySourceQuery = (sourceHash: string) => ({
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

export function usePlotlySource(sourceHash: string | null | undefined) {
  return useQuery({
    ...plotlySourceQuery(sourceHash ?? ""),
    enabled: !!sourceHash,
    // The previous step's figure stays on screen while the next one loads
    // (no placeholder flash).
    placeholderData: keepPreviousData,
  });
}

/** A logged figure's interactive Plotly source (its metadata names it), when it has one. */
export function plotlySourceHash(meta: FigureMetadata | null | undefined): string | null {
  return meta?.has_source && meta.source_format === "plotly_json" ? meta.source_hash ?? null : null;
}

/** A sequence point's Plotly source hash. */
export const pointPlotlySource = (point: SequencePoint): string | null =>
  plotlySourceHash(safeJsonParse<FigureMetadata>(point.artifact_metadata ?? null));

/** Warm one figure: its Plotly source, or its PNG decoded. */
export function prefetchFigure(qc: QueryClient, point: SequencePoint, signal: AbortSignal): Promise<unknown> {
  const source = pointPlotlySource(point);
  return source ? qc.prefetchQuery(plotlySourceQuery(source)) : decodeImage(api.artifactUrl(point.artifact_hash!), signal);
}

export function peekFigure(qc: QueryClient, point: SequencePoint): boolean {
  const source = pointPlotlySource(point);
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
 * `revision` bumps reset the view to the figure's own. A drag rotates a 3D
 * scene whatever the card's 2D drag mode, and every plot on `viewLink`
 * follows the camera live while it is dragged. Scatter traces draw
 * with WebGL per the card's `webgl` setting (the stored figure unchanged).
 * `fallbackSrc` (the stored PNG) stands in while the plot is paused by the
 * page's WebGL budget and no live snapshot of it exists yet.
 */
export function InteractiveFigure({
  figure,
  settings,
  viewOverrides,
  onRelayout,
  revision = 0,
  className,
  style,
  viewLink,
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
  /** The card's 3D camera link: this plot follows the others' drags live, and they follow its. */
  viewLink?: ViewLink;
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
    const out = scene3dLayout(themed, data, dragMode !== "none");
    return viewOverrides && Object.keys(viewOverrides).length > 0 ? applyViewOverrides(out, viewOverrides) : out;
  }, [figure, data, hoverMode, dragMode, showLegend, revision, viewOverrides]);

  const config = useMemo(() => ({ displayModeBar, scrollZoom }), [displayModeBar, scrollZoom]);

  const handleRelayout = useCallback((e: Record<string, unknown>) => {
    const view = onRelayout && extractViewState(e);
    if (view) onRelayout!(view);
  }, [onRelayout]);

  const follower = useMemo<ViewFollower>(() => ({
    showCamera: (sceneId, camera) => showSceneCamera(hostRef.current?.querySelector(".js-plotly-plot") ?? null, sceneId, camera),
    showRanges: (ranges) => showAxisRanges(hostRef.current?.querySelector(".js-plotly-plot") ?? null, ranges),
  }), []);
  useEffect(() => viewLink?.join(follower), [viewLink, follower]);
  const handleRelayouting = useCallback(
    (e: Record<string, unknown>) => viewLink?.moved(follower, e),
    [viewLink, follower],
  );

  return (
    <div ref={hostRef} className={className ?? "rounded bg-bg h-full"} style={style} data-viewer="figure">
      <PlotlyChart
        data={data}
        layout={layout}
        fallbackSrc={fallbackSrc}
        config={config}
        themed={false}
        onRelayout={handleRelayout}
        onRelayouting={handleRelayouting}
      />
    </div>
  );
}

/** Shared view (zoom/pan/camera) wiring, handed down to every figure of a card. */
export interface FigureSync {
  settings: FigureSettings;
  viewOverrides?: SharedView;
  onRelayout?: (view: SharedView) => void;
  revision?: number;
  viewLink?: ViewLink;
}

/**
 * One logged figure: interactive from its Plotly source, else its PNG in the
 * image viewer. `sync` ties it to a card's shared view; without, it is on its
 * own with the figure card's built-in settings.
 */
export default function FigureViewer({
  source,
  sync,
  className,
  label,
}: {
  source: ViewerSource;
  sync?: FigureSync;
  /** Classes of the plot's box (its height). */
  className?: string;
  label?: string;
}) {
  const sourceHash = plotlySourceHash(source.meta as FigureMetadata | null);
  const sourceQ = usePlotlySource(sourceHash);
  if (sourceHash && sourceQ.isSuccess && sourceQ.data?.data) {
    return (
      <InteractiveFigure
        figure={sourceQ.data}
        settings={sync?.settings ?? FIGURE_DEFAULTS}
        viewOverrides={sync?.viewOverrides}
        onRelayout={sync?.onRelayout}
        revision={sync?.revision}
        viewLink={sync?.viewLink}
        fallbackSrc={source.url}
        className={className}
      />
    );
  }
  if (sourceHash && sourceQ.isLoading) {
    return <div className={`${className ?? "h-full"} min-h-[8rem] motion-safe:animate-pulse rounded bg-bg-hover`} />;
  }
  return (
    <div className={`${className ?? "h-full"} overflow-hidden rounded`}>
      {/* Keyed by figure: a new step's PNG starts fitted (the card's shared view is Plotly's). */}
      <ImageViewer key={source.hash} source={source} label={label} toolbar={!sync} />
    </div>
  );
}

/** A Plotly figure given as data (a Plotly JSON file), with the figure card's built-in settings. */
export function PlotlyFigureViewer({ figure, className = "h-[60vh] rounded bg-bg" }: { figure: PlotlyFigure; className?: string }) {
  return <InteractiveFigure figure={figure} settings={FIGURE_DEFAULTS} className={className} />;
}
