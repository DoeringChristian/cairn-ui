import { useEffect, useRef, useState } from "react";
// @ts-expect-error - plotly.js-dist-min ships no types; the runtime API is plotly.js.
import Plotly from "plotly.js-dist-min";

import { readChartTheme, type ChartTheme } from "./theme.ts";
import { useInteract } from "../lib/use-interact.ts";
import { onPrintLayout } from "../lib/print-layout.ts";

export type PlotlyData = Array<Record<string, unknown>>;
export type PlotlyLayout = Record<string, unknown>;

export interface PlotlyChartProps {
  data: PlotlyData;
  layout?: PlotlyLayout;
  config?: Record<string, unknown>;
  /** Merge the app theme (fonts, grid, transparent background) under `layout`. Off for user figures that style themselves. */
  themed?: boolean;
  onRelayout?: (event: Record<string, unknown>) => void;
  onClick?: (event: { points: Array<Record<string, unknown>> }) => void;
  onHover?: (event: { points: Array<Record<string, unknown>> }) => void;
  onUnhover?: () => void;
  className?: string;
}

interface PlotlyDiv extends HTMLDivElement {
  on?: (event: string, handler: (e: never) => void) => void;
  removeAllListeners?: (event: string) => void;
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

/**
 * A Plotly plot that sizes itself to its box. Self-contained: owns the div,
 * the resize observer and the event wiring; each render calls `Plotly.react`
 * (Plotly diffs internally). While not interactive (a touch device with the
 * card's interact toggle off, see lib/use-interact) the plot is static: no
 * drag boxes, hover or scroll zoom, so a finger scrolls the page.
 */
export default function PlotlyChart({
  data, layout = {}, config, themed = true, onRelayout, onClick, onHover, onUnhover, className,
}: PlotlyChartProps) {
  const ref = useRef<PlotlyDiv>(null);
  const handlers = useRef({ onRelayout, onClick, onHover, onUnhover });
  handlers.current = { onRelayout, onClick, onHover, onUnhover };
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

  const fail = (el: PlotlyDiv, err: unknown) => {
    console.warn("PlotlyChart: draw failed; retrying on resize", err);
    try {
      Plotly.purge(el);
    } catch {
      // Already torn down.
    }
    failedRef.current = true;
    setFailed(true);
  };

  draw.current = () => {
    const el = ref.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    const finalLayout = {
      ...(themed ? themedLayout(layout, readChartTheme(el)) : layout),
      autosize: true,
      // Keep zoom/pan across data updates unless the caller changes this.
      uirevision: layout.uirevision ?? "keep",
    };
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
        if (seq !== drawSeq.current) return;
        if (failedRef.current) {
          failedRef.current = false;
          setFailed(false);
        }
        if (!el.removeAllListeners || !el.on) return;
        for (const event of ["plotly_relayout", "plotly_click", "plotly_hover", "plotly_unhover"]) {
          el.removeAllListeners(event);
        }
        el.on("plotly_relayout", (e: never) => handlers.current.onRelayout?.(e));
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
      // Not drawn yet (hidden at mount) or the last draw failed: draw afresh.
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
    return () => {
      ro.disconnect();
      offPrint();
      Plotly.purge(el);
    };
  }, []);

  useEffect(() => {
    draw.current();
  }, [data, layout, config, themed, interactive]);

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={ref} className="h-full w-full" style={{ touchAction: interactive ? undefined : "pan-y" }} />
      {failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
          Too small to draw; make the card larger.
        </div>
      )}
    </div>
  );
}

export { Plotly };
