import { useMemo } from "react";

import { rebinHistograms, type HistogramData } from "../lib/plot-utils/histogram.ts";
import { seriesColor } from "../lib/plot-utils/types.ts";
import PlotlyChart, { type PlotlyData, type PlotlyLayout } from "./PlotlyChart.tsx";

/** Heatmap colormaps. Plotly.js lacks turbo/magma/plasma, so those carry their stops. */
export type Colormap = "turbo" | "magma" | "plasma" | "viridis" | "greys";

type Colorscale = string | Array<[number, string]>;

function stops(rgb: Array<[number, number, number]>): Array<[number, string]> {
  return rgb.map(([r, g, b], i) => [i / (rgb.length - 1), `rgb(${r},${g},${b})`]);
}

const COLORSCALES: Record<Colormap, Colorscale> = {
  turbo: stops([
    [48, 18, 59], [69, 92, 207], [62, 155, 254], [24, 215, 202], [70, 248, 132], [164, 252, 60],
    [225, 221, 55], [254, 164, 49], [240, 91, 18], [195, 37, 3], [122, 4, 3],
  ]),
  magma: stops([
    [0, 0, 4], [21, 14, 56], [59, 15, 112], [101, 26, 128], [140, 41, 129], [183, 55, 121],
    [222, 73, 104], [247, 112, 92], [254, 159, 109], [254, 207, 146], [252, 253, 191],
  ]),
  plasma: stops([[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]]),
  viridis: "Viridis",
  greys: "Greys",
};

export const COLORMAP_OPTIONS: Array<{ value: Colormap; label: string }> = [
  { value: "turbo", label: "Turbo" },
  { value: "magma", label: "Magma" },
  { value: "plasma", label: "Plasma" },
  { value: "viridis", label: "Viridis" },
  { value: "greys", label: "Greys" },
];

function colorscale(name: Colormap): Colorscale {
  return COLORSCALES[name] ?? COLORSCALES.turbo;
}

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

/** Histograms over steps: x = step, y = value (rebinned onto one grid), color = count. */
export function StepHistogramHeatmap({
  perStep, colormap, logColor,
}: {
  perStep: Array<{ step: number } & HistogramData>;
  colormap: Colormap;
  logColor: boolean;
}) {
  const data = useMemo<PlotlyData>(() => {
    const { edges, matrix } = rebinHistograms(perStep);
    const bins = edges.length - 1;
    const z: number[][] = [];
    for (let b = 0; b < bins; b++) {
      z.push(matrix.map((row) => (logColor ? Math.log10(1 + row[b]!) : row[b]!)));
    }
    return [{
      type: "heatmap",
      x: perStep.map((s) => s.step),
      y: Array.from({ length: bins }, (_, b) => (edges[b]! + edges[b + 1]!) / 2),
      z,
      colorscale: colorscale(colormap),
      colorbar: colorbar(logColor ? "log₁₀(1+count)" : "count"),
      hovertemplate: `step %{x}<br>value %{y:.4g}<br>${logColor ? "log₁₀(1+count)" : "count"} %{z:.4g}<extra></extra>`,
    }];
  }, [perStep, colormap, logColor]);
  const layout = useMemo<PlotlyLayout>(() => ({
    xaxis: { title: { text: "step" } },
    yaxis: { title: { text: "value" } },
  }), []);
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
