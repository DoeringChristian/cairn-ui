import { useMemo } from "react";
import { colorscale } from "./colormaps.ts";

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
  className?: string;
}

const NEUTRAL = "#8b949e";

/** One marker per run (scattergl), optionally colored by a value and with its Pareto front. */
export default function ScatterChart({
  points, xLabel, yLabel, colorLabel, xLog, yLog, pareto, className,
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
      text: pts.map(hover),
      hovertemplate: "%{text}<extra></extra>",
      showlegend: false,
      marker: {
        size: 9,
        color,
        ...extra,
      },
    });

    const traces: PlotlyData = [];
    if (colored) {
      const withColor = points.filter((p) => p.color != null);
      const without = points.filter((p) => p.color == null);
      traces.push(markers(withColor, withColor.map((p) => p.color), {
        colorscale: colorscale("turbo"),
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
  }, [points, xLabel, yLabel, colorLabel, pareto]);

  const layout = useMemo(() => ({
    hovermode: "closest",
    xaxis: { title: { text: xLabel ?? "" }, type: xLog ? "log" : "linear" },
    yaxis: { title: { text: yLabel ?? "" }, type: yLog ? "log" : "linear" },
  }), [xLabel, yLabel, xLog, yLog]);

  return (
    <div className={className}>
      <PlotlyChart data={data} layout={layout} />
    </div>
  );
}
