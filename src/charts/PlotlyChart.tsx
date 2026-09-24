import { useEffect, useRef } from "react";
// @ts-expect-error - plotly.js-dist-min ships no types; the runtime API is plotly.js.
import Plotly from "plotly.js-dist-min";

import { readChartTheme, type ChartTheme } from "./theme.ts";

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
export function themedLayout(layout: PlotlyLayout, theme: ChartTheme): PlotlyLayout {
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
 * (Plotly diffs internally).
 */
export default function PlotlyChart({
  data, layout = {}, config, themed = true, onRelayout, onClick, onHover, onUnhover, className,
}: PlotlyChartProps) {
  const ref = useRef<PlotlyDiv>(null);
  const handlers = useRef({ onRelayout, onClick, onHover, onUnhover });
  handlers.current = { onRelayout, onClick, onHover, onUnhover };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0 && el.on) Plotly.Plots.resize(el);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      Plotly.purge(el);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const finalLayout = {
      ...(themed ? themedLayout(layout, readChartTheme(el)) : layout),
      autosize: true,
      // Keep zoom/pan across data updates unless the caller changes this.
      uirevision: layout.uirevision ?? "keep",
    };
    const finalConfig = { displaylogo: false, responsive: false, displayModeBar: false, ...config };
    Promise.resolve(Plotly.react(el, data, finalLayout, finalConfig))
      .then(() => {
        if (!el.removeAllListeners || !el.on) return;
        for (const event of ["plotly_relayout", "plotly_click", "plotly_hover", "plotly_unhover"]) {
          el.removeAllListeners(event);
        }
        el.on("plotly_relayout", (e: never) => handlers.current.onRelayout?.(e));
        el.on("plotly_click", (e: never) => handlers.current.onClick?.(e));
        el.on("plotly_hover", (e: never) => handlers.current.onHover?.(e));
        el.on("plotly_unhover", () => handlers.current.onUnhover?.());
      })
      .catch((err: unknown) => console.warn("PlotlyChart: render error (recovered)", err));
  }, [data, layout, config, themed]);

  return <div ref={ref} className={className ?? "h-full w-full"} />;
}

export { Plotly };
