import { useMemo } from "react";

import type { HistogramData } from "../lib/plot-utils/histogram.ts";
import { seriesColor } from "../lib/plot-utils/types.ts";
import { colorscale, type Colormap } from "./colormaps.ts";
import PlotlyChart, { type PlotlyData, type PlotlyLayout } from "./PlotlyChart.tsx";

const colorbar = (title: string) => ({
  title: { text: title, side: "right", font: { size: 10 } },
  thickness: 10,
  outlinewidth: 0,
  tickfont: { size: 10 },
});

/** One histogram as bars spanning its bin edges. */
export function HistogramBars({ counts, edges, logY }: HistogramData & { logY: boolean }) {
  const data = useMemo<PlotlyData>(() => {
    const x = counts.map((_, i) => (edges[i]! + edges[i + 1]!) / 2);
    const width = counts.map((_, i) => edges[i + 1]! - edges[i]!);
    return [{
      type: "bar",
      x,
      y: counts,
      width,
      customdata: counts.map((_, i) => [edges[i], edges[i + 1]]),
      marker: { color: seriesColor(0), line: { width: 0 } },
      hovertemplate: "[%{customdata[0]:.4g}, %{customdata[1]:.4g})<br>count %{y}<extra></extra>",
    }];
  }, [counts, edges]);
  const layout = useMemo<PlotlyLayout>(() => ({
    bargap: 0,
    xaxis: { title: { text: "value" } },
    yaxis: { title: { text: "count" }, type: logY ? "log" : "linear" },
  }), [logY]);
  return <PlotlyChart data={data} layout={layout} />;
}

/**
 * A 2D slice, row 0 at the top. Color spans [min, max]; `logColor` maps
 * log1p(v − min) so small offsets above the minimum get resolution.
 */
export function MatrixHeatmap({
  matrix, min, max, colormap, logColor, xLabel, yLabel,
}: {
  matrix: number[][];
  min: number;
  max: number;
  colormap: Colormap;
  logColor: boolean;
  xLabel: string;
  yLabel: string;
}) {
  const data = useMemo<PlotlyData>(() => {
    const z = logColor
      ? matrix.map((row) => row.map((v) => Math.log1p(Math.max(0, v - min))))
      : matrix;
    return [{
      type: "heatmap",
      z,
      customdata: logColor ? matrix : undefined,
      zmin: logColor ? 0 : min,
      zmax: logColor ? Math.log1p(Math.max(0, max - min)) : max,
      colorscale: colorscale(colormap),
      colorbar: colorbar(logColor ? "log1p(value − min)" : "value"),
      hovertemplate: `[%{y}, %{x}] = ${logColor ? "%{customdata:.4g}" : "%{z:.4g}"}<extra></extra>`,
    }];
  }, [matrix, min, max, colormap, logColor]);
  const layout = useMemo<PlotlyLayout>(() => ({
    xaxis: { title: { text: xLabel }, showgrid: false, zeroline: false },
    yaxis: { title: { text: yLabel }, showgrid: false, zeroline: false, autorange: "reversed" },
  }), [xLabel, yLabel]);
  return <PlotlyChart data={data} layout={layout} />;
}
