import { useMemo, useRef, type MouseEvent } from "react";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { readChartTheme } from "./theme.ts";
import { computeParetoFront, type ParetoDirection } from "../lib/plot-utils/pareto.ts";
import { formatNum } from "../lib/plot-utils/types.ts";

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  color: number | null;
  label?: string;
}

interface Props {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  colorLabel?: string;
  xLog?: boolean;
  yLog?: boolean;
  /** Draw the Pareto front for this direction; omitted = no front. */
  pareto?: ParetoDirection;
  selectedIds?: Set<string>;
  onClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  className?: string;
}

const NEUTRAL = "#8b949e";

/** One marker per run (scattergl), optionally colored by a value and with its Pareto front. */
export default function ScatterChart({
  points, xLabel, yLabel, colorLabel, xLog, yLog, pareto, selectedIds, onClick, onBackgroundClick, className,
}: Props) {
  const data = useMemo<PlotlyData>(() => {
    const theme = readChartTheme(null);
    const colored = points.some((p) => p.color != null);
    const hover = (p: ScatterPoint) =>
      [
        `<b>${p.label ?? p.id}</b>`,
        `${xLabel ?? "x"}: ${formatNum(p.x)}`,
        `${yLabel ?? "y"}: ${formatNum(p.y)}`,
        ...(colorLabel && p.color != null ? [`${colorLabel}: ${formatNum(p.color)}`] : []),
      ].join("<br>");
    const markers = (pts: ScatterPoint[], color: unknown, extra: Record<string, unknown> = {}) => ({
      type: "scattergl",
      mode: "markers",
      x: pts.map((p) => p.x),
      y: pts.map((p) => p.y),
      customdata: pts.map((p) => p.id),
      text: pts.map(hover),
      hovertemplate: "%{text}<extra></extra>",
      showlegend: false,
      marker: {
        size: 9,
        color,
        line: {
          width: pts.map((p) => (selectedIds?.has(p.id) ? 2 : 0)),
          color: theme.fg,
        },
        ...extra,
      },
    });

    const traces: PlotlyData = [];
    if (colored) {
      const withColor = points.filter((p) => p.color != null);
      const without = points.filter((p) => p.color == null);
      traces.push(markers(withColor, withColor.map((p) => p.color), {
        colorscale: "Viridis",
        showscale: true,
        colorbar: { title: { text: colorLabel ?? "", side: "right" }, thickness: 10, outlinewidth: 0 },
      }));
      if (without.length) traces.push(markers(without, NEUTRAL));
    } else {
      traces.push(markers(points, theme.accent));
    }

    if (pareto) {
      const front = computeParetoFront(points, pareto).sort((a, b) => a.x - b.x);
      if (front.length >= 2) {
        traces.unshift({
          type: "scattergl",
          mode: "lines",
          x: front.map((p) => p.x),
          y: front.map((p) => p.y),
          // Step between front points: the dominated region's staircase.
          line: { color: theme.accent, width: 1.5, dash: "dash", shape: pareto.endsWith("min") ? "hv" : "vh" },
          hoverinfo: "skip",
          showlegend: false,
        });
      }
    }
    return traces;
  }, [points, xLabel, yLabel, colorLabel, pareto, selectedIds]);

  const layout = useMemo(() => ({
    hovermode: "closest",
    xaxis: { title: { text: xLabel ?? "" }, type: xLog ? "log" : "linear" },
    yaxis: { title: { text: yLabel ?? "" }, type: yLog ? "log" : "linear" },
  }), [xLabel, yLabel, xLog, yLog]);

  const bg = useBackgroundClick(onBackgroundClick);

  return (
    <div className={className} {...bg.wrapper}>
      <PlotlyChart
        data={data}
        layout={layout}
        onClick={(e) => {
          const id = e.points.find((p) => typeof p.customdata === "string")?.customdata as string | undefined;
          if (id == null) return;
          bg.pointClicked();
          onClick?.(id);
        }}
      />
    </div>
  );
}

/**
 * Plotly reports clicks only on marks; this turns a press that hit no mark
 * (and was not a drag) into `onBackgroundClick`. Spread `wrapper` on the
 * chart's parent div and call `pointClicked()` from the Plotly click.
 *
 * Listens for the release on `window`: Plotly lays a cover over the page
 * while the button is down, so the DOM `click` never reaches the chart, and
 * its own (synchronous) `plotly_click` runs on `document` before `window`.
 */
export function useBackgroundClick(onBackgroundClick?: () => void) {
  const hit = useRef(false);
  const callback = useRef(onBackgroundClick);
  callback.current = onBackgroundClick;
  return {
    pointClicked: () => { hit.current = true; },
    wrapper: {
      onMouseDown: (e: MouseEvent) => {
        if (e.button !== 0) return;
        const x = e.clientX;
        const y = e.clientY;
        hit.current = false;
        window.addEventListener("mouseup", (up) => {
          if (!hit.current && Math.hypot(up.clientX - x, up.clientY - y) <= 4) callback.current?.();
        }, { once: true });
      },
    },
  };
}
