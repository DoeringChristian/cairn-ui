import { useMemo } from "react";
import { colorscale } from "./colormaps.ts";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { readChartTheme, withAlpha } from "./theme.ts";
import { computeParetoFront, paretoLineShape, type ParetoDirection } from "../lib/plot-utils/pareto.ts";
import {
  axisRange,
  refLineShapes,
  regressionLine,
  runningStat,
  type RefLine,
  type RunningStat,
} from "../lib/plot-utils/scatter-extras.ts";
import { formatNum } from "../lib/plot-utils/types.ts";

export interface ScatterPoint {
  /** The run id (a click opens it). */
  id: string;
  x: number;
  y: number;
  /** The colour expression's value; null = no value (neutral), or no colour expression. */
  color: number | null;
  /** The run's own colour, used when there is no colour expression. */
  runColor: string;
  label: string;
  /** Extra tooltip lines: [label, value]. */
  extra?: Array<[string, string]>;
}

export interface AxisRangeValue {
  min: number | null;
  max: number | null;
  log: boolean;
}

interface Props {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  /** Set when the points are coloured by a value (a colour scale). */
  colorLabel?: string;
  xRange: AxisRangeValue;
  yRange: AxisRangeValue;
  /** Draw the Pareto front for these per-axis directions; omitted = no front. */
  pareto?: ParetoDirection;
  /** With `pareto`: fade the points off the front. */
  dimNonFrontier?: boolean;
  running?: readonly RunningStat[];
  regression?: boolean;
  refLines?: readonly RefLine[];
  /** A click on a point, with its run id. */
  onPointClick?: (id: string) => void;
  className?: string;
}

const NEUTRAL = "#8b949e";
const DIM = 0.2;
const RUNNING_DASH: Record<RunningStat, string> = { min: "dot", max: "dashdot", mean: "solid" };
const NO_LINES: readonly never[] = [];

/** One marker per run (scattergl), coloured by run or by a value, with optional overlays. */
export default function ScatterChart({
  points, xLabel, yLabel, colorLabel, xRange, yRange, pareto, dimNonFrontier,
  running = NO_LINES, regression, refLines = NO_LINES, onPointClick, className,
}: Props) {
  const theme = readChartTheme(null);
  const xLog = xRange.log;
  const yLog = yRange.log;

  const front = useMemo(
    () => (pareto ? computeParetoFront(points, pareto).sort((a, b) => a.x - b.x) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, pareto?.x, pareto?.y],
  );

  const data = useMemo<PlotlyData>(() => {
    const onFront = new Set(front.map((p) => p.id));
    const dim = pareto && dimNonFrontier;
    const hover = (p: ScatterPoint) =>
      [
        `<b>${p.label}</b>`,
        `${xLabel ?? "x"}: ${formatNum(p.x)}`,
        `${yLabel ?? "y"}: ${formatNum(p.y)}`,
        ...(colorLabel && p.color != null ? [`${colorLabel}: ${formatNum(p.color)}`] : []),
        ...(p.extra ?? []).map(([k, v]) => `${k}: ${v}`),
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
        ...(dim ? { opacity: pts.map((p) => (onFront.has(p.id) ? 1 : DIM)) } : {}),
        ...extra,
      },
    });

    const traces: PlotlyData = [];
    if (colorLabel) {
      const withColor = points.filter((p) => p.color != null);
      const without = points.filter((p) => p.color == null);
      traces.push(markers(withColor, withColor.map((p) => p.color), {
        colorscale: colorscale("turbo"),
        showscale: true,
        colorbar: { title: { text: colorLabel, side: "right" }, thickness: 10, outlinewidth: 0 },
      }));
      if (without.length) traces.push(markers(without, NEUTRAL));
    } else {
      traces.push(markers(points, points.map((p) => p.runColor)));
    }

    const lines: PlotlyData = [];
    if (pareto && front.length >= 2) {
      lines.push({
        type: "scattergl",
        mode: "lines",
        x: front.map((p) => p.x),
        y: front.map((p) => p.y),
        // Step between front points: the dominated region's staircase.
        line: { color: theme.accent, width: 1.5, dash: "dash", shape: paretoLineShape(pareto) },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
    for (const stat of running) {
      const r = runningStat(points, stat);
      if (r.x.length < 2) continue;
      lines.push({
        type: "scatter",
        mode: "lines",
        x: r.x,
        y: r.y,
        line: { color: withAlpha(theme.fgMuted, 0.8), width: 1.5, dash: RUNNING_DASH[stat], shape: "hv" },
        hovertemplate: `running ${stat}: %{y}<extra></extra>`,
        showlegend: false,
      });
    }
    if (regression) {
      const fit = regressionLine(points, { xLog, yLog });
      if (fit) {
        lines.push({
          type: "scatter",
          mode: "lines",
          x: fit.x,
          y: fit.y,
          line: { color: withAlpha(theme.fg, 0.6), width: 1.5 },
          hovertemplate:
            `fit: slope ${formatNum(fit.fit.slope)}, intercept ${formatNum(fit.fit.intercept)}` +
            `<br>R² ${formatNum(fit.fit.r2)} (${fit.fit.n} runs)` +
            `${xLog || yLog ? "<br>fitted in log space" : ""}<extra></extra>`,
          showlegend: false,
        });
      }
    }
    // Lines under the markers.
    return [...lines, ...traces];
  }, [points, front, xLabel, yLabel, colorLabel, pareto, dimNonFrontier, running, regression,
    xLog, yLog, theme.accent, theme.fg, theme.fgMuted]);

  const layout = useMemo(() => {
    const { shapes, annotations } = refLineShapes(refLines, { xLog, yLog, color: theme.fgMuted });
    return {
      hovermode: "closest",
      // New ranges from the settings replace the user's zoom.
      uirevision: JSON.stringify([xRange, yRange]),
      xaxis: { title: { text: xLabel ?? "" }, type: xLog ? "log" : "linear", ...axisRange(xRange) },
      yaxis: { title: { text: yLabel ?? "" }, type: yLog ? "log" : "linear", ...axisRange(yRange) },
      shapes,
      annotations,
    };
  }, [xLabel, yLabel, xRange, yRange, xLog, yLog, refLines, theme.fgMuted]);

  return (
    <div className={className}>
      <PlotlyChart
        data={data}
        layout={layout}
        onClick={onPointClick ? (e) => {
          const id = e.points.find((p) => typeof p.customdata === "string")?.customdata;
          if (typeof id === "string") onPointClick(id);
        } : undefined}
      />
    </div>
  );
}
