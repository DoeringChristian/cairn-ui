import { useEffect, useMemo, useRef, useState } from "react";

import { readChartTheme, type ChartTheme } from "./theme.ts";
import { useInteract } from "../lib/use-interact.ts";
import { onPrintLayout } from "../lib/print-layout.ts";
import { glContextEstimate } from "../lib/plot-utils/gl-budget.ts";
import { applyViewOverrides, extractViewState, mergeRelayout, reconcileOwnView, type SharedView } from "../lib/plot-utils/view-overrides.ts";
import { glBudget, glContextsIn, loseContexts, type GlRegistration } from "./gl-budget-manager.ts";
import { loadPlotly, plotly as Plotly } from "./plotly-loader.ts";

export type PlotlyData = Array<Record<string, unknown>>;
export type PlotlyLayout = Record<string, unknown>;

export interface PlotlyChartProps {
  data: PlotlyData;
  layout?: PlotlyLayout;
  config?: Record<string, unknown>;
  /** Merge the app theme (fonts, grid, transparent background) under `layout`. Off for user figures that style themselves. */
  themed?: boolean;
  onRelayout?: (event: Record<string, unknown>) => void;
  /** Fires continuously while the user drags the view (a 3D camera, a 2D pan). */
  onRelayouting?: (event: Record<string, unknown>) => void;
  onClick?: (event: { points: Array<Record<string, unknown>> }) => void;
  onHover?: (event: { points: Array<Record<string, unknown>> }) => void;
  onUnhover?: () => void;
  className?: string;
  /**
   * A picture of the figure (its stored PNG rendition) shown while a WebGL
   * plot is paused and no snapshot of the live plot exists yet. A blank
   * placeholder image (1×1) is ignored.
   */
  fallbackSrc?: string;
}

interface PlotlyDiv extends HTMLDivElement {
  on?: (event: string, handler: (e: never) => void) => void;
  removeAllListeners?: (event: string) => void;
  _fullLayout?: unknown;
}

/**
 * Purge a plot and lose its WebGL contexts (Plotly.purge alone keeps them
 * until GC). `held` adds contexts collected earlier, before something
 * detached their canvases.
 */
function purgeAndRelease(el: PlotlyDiv, held: ReturnType<typeof glContextsIn> = []): void {
  const contexts = [...held, ...glContextsIn(el)];
  try {
    Plotly?.purge(el);
  } catch {
    // Already torn down.
  }
  loseContexts(contexts);
}

/**
 * A picture of the plot as drawn now — its SVG layers with the WebGL layers
 * embedded as images (Plotly's own exporter, run on the live plot: no second
 * plot, no extra WebGL context). Returns an object URL, or null.
 *
 * The exporter tears the plot's 3D scenes down (it is meant for a throwaway
 * clone), so the plot must be purged afterwards, with its contexts collected
 * before this call.
 */
async function snapshotPlot(el: PlotlyDiv): Promise<string | null> {
  if (!el._fullLayout || !Plotly) return null;
  try {
    let svg = String(await Promise.resolve(Plotly.Snapshot.toSVG(el)));
    // The app theme sets fonts to "inherit", which a standalone SVG resolves
    // to the browser default; pin the font the plot actually shows.
    const family = getComputedStyle(el).fontFamily.replace(/"/g, "'");
    svg = svg.replace(/font-family:\s*inherit/g, `font-family: ${family}`);
    return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  } catch (err) {
    console.warn("PlotlyChart: snapshot failed", err);
    return null;
  }
}

/**
 * Show `camera` on a drawn plot's 3D scene right away, without a relayout:
 * no event, no redraw, nothing written to the plot's layout. For following
 * another plot's camera while its user drags it; the final camera arrives
 * through the layout as usual. A paused or undrawn plot is left alone.
 */
export function showSceneCamera(el: HTMLElement | null, sceneId: string, camera: Record<string, unknown>): void {
  const scene = ((el as PlotlyDiv | null)?._fullLayout as Record<string, { _scene?: PlotlyScene } | undefined> | undefined)?.[sceneId]?._scene;
  if (!scene?.setViewport || !scene.glplot) return;
  try {
    const current = scene.getCamera();
    scene.setViewport({ camera: { ...current, ...camera, projection: current.projection }, aspectratio: scene.glplot.getAspectratio() });
  } catch {
    // Scene mid-teardown.
  }
}

/** The current camera of every drawn 3D scene, as relayout keys; null without any. */
function liveSceneCameras(el: PlotlyDiv): Record<string, unknown> | null {
  const fl = el._fullLayout as Record<string, { _scene?: PlotlyScene } | undefined> | undefined;
  if (!fl) return null;
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(fl)) {
    const scene = /^scene\d*$/.test(k) ? fl[k]?._scene : undefined;
    if (!scene?.glplot) continue;
    try {
      (out ??= {})[`${k}.camera`] = scene.getCamera();
    } catch {
      // Scene mid-teardown.
    }
  }
  return out;
}

/** A relayout event that only touches 3D scenes. */
function isSceneOnly(e: Record<string, unknown>): boolean {
  const keys = Object.keys(e);
  return keys.length > 0 && keys.every((k) => /^scene\d*(\.|$)/.test(k));
}

interface PlotlyScene {
  setViewport?: (v: { camera: Record<string, unknown>; aspectratio: unknown }) => void;
  getCamera: () => Record<string, unknown> & { projection: unknown };
  glplot?: { getAspectratio: () => unknown };
}

function axisTheme(theme: ChartTheme): PlotlyLayout {
  return {
    gridcolor: theme.grid,
    linecolor: theme.grid,
    zerolinecolor: theme.grid,
    tickfont: { family: theme.mono, size: 10, color: theme.fgMuted },
    title: { font: { size: 11, color: theme.fgMuted } },
    automargin: true,
  };
}

/** The app theme as a Plotly layout; caller layout keys win (deep for axes). */
function themedLayout(layout: PlotlyLayout, theme: ChartTheme): PlotlyLayout {
  const base: PlotlyLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "inherit", size: 11, color: theme.fgMuted },
    margin: { l: 48, r: 12, t: 12, b: 36 },
    legend: { font: { size: 10, color: theme.fgMuted }, bgcolor: "rgba(0,0,0,0)" },
    hoverlabel: { font: { family: theme.mono, size: 11 } },
  };
  const out: PlotlyLayout = { ...base, ...layout };
  for (const key of Object.keys({ xaxis: 1, yaxis: 1, ...layout })) {
    if (/^[xy]axis\d*$/.test(key)) {
      out[key] = { ...axisTheme(theme), ...((layout[key] as PlotlyLayout | undefined) ?? {}) };
    }
  }
  return out;
}


type GlState = "live" | "pending" | "paused";

/**
 * A Plotly plot that sizes itself to its box. Self-contained: owns the div,
 * the resize observer and the event wiring; each render calls `Plotly.react`
 * (Plotly diffs internally). While not interactive (a touch device with the
 * card's interact toggle off, see lib/use-interact) the plot is static: no
 * drag boxes, hover or scroll zoom, so a finger scrolls the page.
 *
 * A plot with WebGL traces (3D, scattergl, splom, parcoords, maps) joins the
 * page's WebGL budget (charts/gl-budget-manager): it draws only while the
 * budget lets it; otherwise it is purged, its contexts released, and a
 * snapshot of it shown — the last live picture, else `fallbackSrc`, else a
 * note — until it scrolls back into view or is hovered or clicked. Its
 * camera and zoom survive the pause. A context the browser takes away
 * (too many on the page) is handled the same way: never a blank plot.
 */
export default function PlotlyChart({
  data, layout = {}, config, themed = true, onRelayout, onRelayouting, onClick, onHover, onUnhover, className, fallbackSrc,
}: PlotlyChartProps) {
  const ref = useRef<PlotlyDiv>(null);
  const handlers = useRef({ onRelayout, onRelayouting, onClick, onHover, onUnhover });
  handlers.current = { onRelayout, onRelayouting, onClick, onHover, onUnhover };
  const interactive = useInteract();
  // Plotly throws ("Something went wrong with axis scaling") when a colour
  // bar or 3D scene gets a box too small to lay out. Such a draw is dropped
  // (the plot is purged and a note shown) and retried on the next resize.
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  const draw = useRef<() => void>(() => {});
  // Only the latest draw's outcome counts: an older draw failing late must
  // not purge a newer successful one.
  const drawSeq = useRef(0);

  // --- WebGL budget -------------------------------------------------------
  const glEstimate = useMemo(() => glContextEstimate(data), [data]);
  const managed = glEstimate > 0;
  const managedRef = useRef(managed);
  managedRef.current = managed;
  // Whether the plot may hold WebGL contexts (always, for an SVG-only plot).
  const liveRef = useRef(!managed);
  const [glState, setGlState] = useState<GlState>(managed ? "pending" : "live");
  const reg = useRef<GlRegistration | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  // The last live picture, valid for the data it was taken of.
  const [snapshot, setSnapshot] = useState<{ url: string; data: PlotlyData } | null>(null);
  const snapshotUrl = useRef<string | null>(null);
  const [fallbackBlank, setFallbackBlank] = useState(false);
  // The user's camera/zoom under the current uirevision, re-applied on every
  // draw: a plot redrawn after a pause starts from a fresh div, so Plotly's
  // own uirevision memory is gone.
  const glView = useRef<{ rev: unknown; view: SharedView }>({ rev: undefined, view: {} });
  // The layout of the last draw: a view key whose layout value changed since
  // (the host moved the view) overrides the plot's own view above.
  const drawnLayout = useRef<PlotlyLayout | undefined>(undefined);
  // A pointer is down on the plot (a drag in progress): redraws wait for its
  // release. Plotly.react mid-drag resets a 3D scene to the layout's camera,
  // snapping the rotation back.
  const dragging = useRef(false);
  const drawDeferred = useRef(false);
  const unmounted = useRef(false);

  const fail = (el: PlotlyDiv, err: unknown) => {
    console.warn("PlotlyChart: draw failed; retrying on resize", err);
    purgeAndRelease(el);
    failedRef.current = true;
    setFailed(true);
  };

  const viewChanged = (e: Record<string, unknown>) => {
    if (managedRef.current) {
      const v = extractViewState(e);
      if (v) glView.current = { ...glView.current, view: mergeRelayout(glView.current.view, v) };
    }
    handlers.current.onRelayout?.(e);
  };
  // Within a wheel event's dispatch (see the wheel watcher below).
  const inWheel = useRef(false);

  // Draws wait for Plotly to load (the first plot of the page loads it).
  const [plotlyReady, setPlotlyReady] = useState(Plotly != null);
  useEffect(() => {
    if (plotlyReady) return;
    let live = true;
    void loadPlotly().then(() => live && setPlotlyReady(true));
    return () => {
      live = false;
    };
  }, [plotlyReady]);

  draw.current = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0 || !Plotly) return;
    if (managedRef.current && !liveRef.current) return;
    if (dragging.current) {
      drawDeferred.current = true;
      return;
    }
    drawDeferred.current = false;
    let finalLayout: PlotlyLayout = {
      ...(themed ? themedLayout(layout, readChartTheme(el)) : layout),
      autosize: true,
      // Keep zoom/pan across data updates unless the caller changes this.
      uirevision: layout.uirevision ?? "keep",
    };
    if (managedRef.current) {
      if (glView.current.rev !== finalLayout.uirevision) glView.current = { rev: finalLayout.uirevision, view: {} };
      else if (Object.keys(glView.current.view).length > 0) {
        glView.current = { ...glView.current, view: reconcileOwnView(drawnLayout.current, layout, glView.current.view) };
        finalLayout = applyViewOverrides(finalLayout, glView.current.view);
      }
      drawnLayout.current = layout;
    }
    const finalConfig = {
      displaylogo: false, responsive: false, displayModeBar: false, ...config,
      ...(interactive ? {} : { staticPlot: true, scrollZoom: false }),
    };
    const seq = ++drawSeq.current;
    let drawn: Promise<unknown>;
    try {
      drawn = Promise.resolve(Plotly.react(el, data, finalLayout, finalConfig));
    } catch (err) {
      fail(el, err);
      return;
    }
    drawn
      .then(() => {
        // Unmounted while Plotly was still drawing: whatever it created
        // (3D scenes) is orphaned; release it.
        if (!el.isConnected && unmounted.current) {
          purgeAndRelease(el);
          return;
        }
        if (seq !== drawSeq.current) return;
        if (failedRef.current) {
          failedRef.current = false;
          setFailed(false);
        }
        if (managedRef.current) reg.current?.setWeight(glContextsIn(el).length || glEstimate);
        if (!el.removeAllListeners || !el.on) return;
        for (const event of ["plotly_relayout", "plotly_relayouting", "plotly_click", "plotly_hover", "plotly_unhover"]) {
          el.removeAllListeners(event);
        }
        el.on("plotly_relayout", (e: never) => {
          // A 3D scene reports a wheel zoom before applying it (the camera it
          // sends is the one before this wheel tick); the wheel watcher below
          // reports the real camera instead.
          if (inWheel.current && isSceneOnly(e)) return;
          viewChanged(e);
        });
        el.on("plotly_relayouting", (e: never) => handlers.current.onRelayouting?.(e));
        el.on("plotly_click", (e: never) => handlers.current.onClick?.(e));
        el.on("plotly_hover", (e: never) => handlers.current.onHover?.(e));
        el.on("plotly_unhover", () => handlers.current.onUnhover?.());
      })
      .catch((err: unknown) => {
        if (seq === drawSeq.current) fail(el, err);
      });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      if (managedRef.current && !liveRef.current) return;
      // Not drawn yet (hidden at mount) or the last draw failed: draw afresh.
      if (!Plotly) return;
      if (failedRef.current || !el.on) {
        draw.current();
        return;
      }
      const seq = drawSeq.current;
      try {
        Promise.resolve(Plotly.Plots.resize(el)).catch((err: unknown) => {
          if (seq === drawSeq.current) fail(el, err);
        });
      } catch (err) {
        fail(el, err);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const offPrint = onPrintLayout(resize);
    // The browser took a context away (too many on the page): stop drawing,
    // show the last picture, and wait to be used or scrolled back into view.
    // (Contexts released on purpose are lost after `liveRef` drops, and on
    // canvases already detached from the plot.)
    const onLost = (e: Event) => {
      if (!managedRef.current || !liveRef.current) return;
      // Recovery is ours: keep the event from Plotly's own handler, which
      // would recreate the scene's context (pushing out another plot) and,
      // once the plot is purged, throw from its retry loop.
      e.stopPropagation();
      liveRef.current = false;
      drawSeq.current++;
      reg.current?.lost();
      setTimeout(() => purgeAndRelease(el), 0);
      setGlState("paused");
    };
    el.addEventListener("webglcontextlost", onLost, true);
    // Wheel zoom on 3D scenes: Plotly applies the zoom over the next frames
    // but reports it early (stale), so follow the scenes' real cameras while
    // the wheel turns (live, to linked plots) and report the settled camera
    // once it stops.
    let wheelUntil = 0;
    let wheelFrame = 0;
    let wheelLast = "";
    let wheelBase = "";
    const wheelTick = () => {
      wheelFrame = 0;
      const cams = liveSceneCameras(el);
      if (!cams) return;
      const key = JSON.stringify(cams);
      const settled = performance.now() > wheelUntil;
      if (key !== wheelLast) {
        wheelLast = key;
        handlers.current.onRelayouting?.(cams);
      }
      if (settled) {
        if (key !== wheelBase) viewChanged(cams);
        return;
      }
      wheelFrame = requestAnimationFrame(wheelTick);
    };
    const onWheel = () => {
      const cams = liveSceneCameras(el);
      if (!cams) return;
      inWheel.current = true;
      setTimeout(() => { inWheel.current = false; }, 0);
      wheelUntil = performance.now() + 250;
      if (!wheelFrame) {
        wheelLast = wheelBase = JSON.stringify(cams);
        wheelFrame = requestAnimationFrame(wheelTick);
      }
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      // A 3D scene's camera controls read the held button from every mouse
      // move over their own canvas: a drag that strays onto a neighbouring
      // 3D plot (a gallery cell, the next pane) would start rotating that one
      // too, and stop rotating this one. Capture the pointer so the whole
      // drag goes to the scene it started on.
      const t = e.target as Element | null;
      if (t?.tagName === "CANVAS" && e.button === 0) {
        try {
          t.setPointerCapture(e.pointerId);
        } catch {
          // Pointer already gone.
        }
      }
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (drawDeferred.current) draw.current();
    };
    el.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      cancelAnimationFrame(wheelFrame);
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      ro.disconnect();
      offPrint();
      el.removeEventListener("webglcontextlost", onLost, true);
      unmounted.current = true;
      purgeAndRelease(el);
      if (snapshotUrl.current) URL.revokeObjectURL(snapshotUrl.current);
    };
  }, []);

  // Join (or leave) the WebGL budget as the traces gain (or lose) WebGL.
  useEffect(() => {
    const el = ref.current;
    if (!managed || !el) {
      liveRef.current = true;
      setGlState("live");
      return;
    }
    liveRef.current = false;
    const r = glBudget.register(el, {
      activate: () => {
        liveRef.current = true;
        setGlState("live");
        draw.current();
      },
      deactivate: async () => {
        const shownData = dataRef.current;
        const wasLive = liveRef.current;
        // No draws from here on: the snapshot dismantles the 3D scenes.
        liveRef.current = false;
        drawSeq.current++;
        const held = glContextsIn(el);
        const url = wasLive ? await snapshotPlot(el) : null;
        purgeAndRelease(el, held);
        if (url) {
          if (snapshotUrl.current) URL.revokeObjectURL(snapshotUrl.current);
          snapshotUrl.current = url;
          setSnapshot({ url, data: shownData });
        }
        setGlState("paused");
      },
    }, glEstimate);
    reg.current = r;
    return () => {
      r.unregister();
      reg.current = null;
      liveRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managed]);

  useEffect(() => {
    reg.current?.setWeight(glEstimate);
  }, [glEstimate]);

  useEffect(() => setFallbackBlank(false), [fallbackSrc]);

  useEffect(() => {
    draw.current();
  }, [data, layout, config, themed, interactive, plotlyReady]);

  const paused = managed && glState !== "live";
  const snap = snapshot && snapshot.data === data ? snapshot.url : null;
  const picture = snap ?? (fallbackSrc && !fallbackBlank ? fallbackSrc : null);

  return (
    <div
      className={`relative ${className ?? "h-full w-full"}`}
      data-cairn-plotly={managed ? glState : undefined}
      onPointerEnter={() => reg.current?.pin(true)}
      onPointerLeave={() => reg.current?.pin(false)}
      onPointerDown={() => reg.current?.touch()}
      onWheel={() => reg.current?.touch()}
    >
      <div ref={ref} className="h-full w-full" style={{ touchAction: interactive ? undefined : "pan-y" }} />
      {paused && (
        <div
          className="absolute inset-0 flex cursor-pointer items-center justify-center"
          data-cairn-gl-paused={glState}
          title="Paused to stay within the browser's WebGL limit; hover or click to draw it"
          onClick={() => reg.current?.touch()}
        >
          {picture && (
            <img
              src={picture}
              alt=""
              draggable={false}
              className="h-full w-full object-contain"
              onLoad={(e) => {
                if (picture === fallbackSrc && e.currentTarget.naturalWidth <= 1) setFallbackBlank(true);
              }}
            />
          )}
          {glState === "paused" && !picture && (
            <span className="text-xs text-fg-subtle">WebGL plot paused: hover or click to draw it</span>
          )}
        </div>
      )}
      {failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
          Too small to draw; make the card larger.
        </div>
      )}
    </div>
  );
}


