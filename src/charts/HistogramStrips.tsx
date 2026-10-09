import { useMemo, useRef, useState, type CSSProperties } from "react";

import { maxZ, stripTooltip, stripZ, type Strip, type StripTooltip } from "../lib/plot-utils/histogram-strips.ts";
import { formatNum } from "../lib/plot-utils/format.ts";
import { colorscale, type Colormap } from "./colormaps.ts";
import PlotlyChart, { type PlotlyData, type PlotlyLayout } from "./PlotlyChart.tsx";

export type HistogramXAxis = "step" | "relative_time" | "wall_time";

const X_TITLE: Record<HistogramXAxis, string> = {
  step: "step",
  relative_time: "relative time (s)",
  wall_time: "wall time",
};

/** Space for a strip's label above it, and between strips, as a fraction of the plot's height. */
const LABEL_GAP = 0.075;
const STRIP_GAP = 0.03;

/** Strip `i` of `n`'s vertical domain, top to bottom (`labels`: leave room for a label above each). */
export function stripDomain(i: number, n: number, labels: boolean): [number, number] {
  const label = labels ? LABEL_GAP : 0;
  const h = (1 - n * label - (n - 1) * STRIP_GAP) / n;
  const top = 1 - i * (h + label + STRIP_GAP) - label;
  return [Math.max(0, top - h), Math.min(1, top)];
}

interface Hover {
  strip: number;
  tip: StripTooltip;
  left: number;
  top: number;
}

/**
 * Histograms over steps, one heatmap strip per run or group, stacked on one
 * x axis and one value axis (wandb's histogram panel): x = the step (or
 * time), y = value, colour = the share of that step's samples in the bin
 * (or log₁₀(1+count)). Hovering a cell shows that step's histogram of its
 * strip as small bars.
 */
export function HistogramStrips({
  strips, edges, colormap, logColor, xAxis,
}: {
  strips: Strip[];
  edges: number[];
  colormap: Colormap;
  logColor: boolean;
  xAxis: HistogramXAxis;
}) {
  const labels = strips.length > 1;
  const scale = logColor ? "log" : "density";
  const zTitle = logColor ? "log₁₀(1+count)" : "density";
  const { data, layout } = useMemo(() => {
    const zs = strips.map((s) => stripZ(s, scale));
    const zmax = maxZ(zs);
    const centres = Array.from({ length: edges.length - 1 }, (_, b) => (edges[b]! + edges[b + 1]!) / 2);
    const n = strips.length;
    const data: PlotlyData = strips.map((s, i) => ({
      type: "heatmap",
      x: xAxis === "wall_time" ? s.xs.map((ms) => new Date(ms).toISOString()) : s.xs,
      y: centres,
      z: zs[i],
      xaxis: "x",
      yaxis: i === 0 ? "y" : `y${i + 1}`,
      colorscale: colorscale(colormap),
      zmin: 0,
      zmax,
      showscale: i === 0,
      colorbar: { title: { text: zTitle, side: "right", font: { size: 10 } }, thickness: 10, outlinewidth: 0, tickfont: { size: 10 } },
      hoverinfo: "none",
      hoverongaps: true,
    }));
    const range = [edges[0], edges[edges.length - 1]];
    const layout: PlotlyLayout = {
      xaxis: {
        title: { text: X_TITLE[xAxis] },
        type: xAxis === "wall_time" ? "date" : "linear",
        anchor: n === 1 ? "y" : `y${n}`,
        showgrid: false,
        zeroline: false,
      },
      annotations: labels
        ? strips.map((s, i) => ({
            text: `<span style="color:${s.color}">●</span> ${escapeHtml(s.label)}`,
            xref: "paper",
            yref: "paper",
            x: 0,
            y: stripDomain(i, n, true)[1],
            xanchor: "left",
            yanchor: "bottom",
            showarrow: false,
            font: { size: 11 },
          }))
        : [],
      margin: { t: labels ? 8 : 10 },
    };
    strips.forEach((_, i) => {
      layout[i === 0 ? "yaxis" : `yaxis${i + 1}`] = {
        domain: stripDomain(i, n, labels),
        range,
        anchor: "x",
        showgrid: false,
        zeroline: false,
        title: n === 1 ? { text: "value" } : undefined,
        tickfont: { size: 10 },
        nticks: n > 2 ? 3 : 5,
      };
    });
    return { data, layout };
  }, [strips, edges, colormap, scale, zTitle, xAxis, labels]);

  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const onHover = (e: { points: Array<Record<string, unknown>>; event?: MouseEvent }) => {
    const p = e.points[0];
    const el = box.current;
    if (!p || !el) return;
    const i = Number(p.curveNumber);
    const strip = strips[i];
    const pn = p.pointNumber as unknown;
    if (!strip || !Array.isArray(pn)) return;
    const col = Number(pn[1]);
    const tip = stripTooltip(strip, edges, strip.xs[col] ?? 0, centre(edges, Number(pn[0])));
    if (!tip) return;
    const r = el.getBoundingClientRect();
    const mx = (e.event?.clientX ?? r.left) - r.left;
    const my = (e.event?.clientY ?? r.top) - r.top;
    const w = 200;
    setHover({
      strip: i,
      tip,
      left: mx + 14 + w > r.width ? Math.max(0, mx - 14 - w) : mx + 14,
      top: Math.max(0, Math.min(my - 20, r.height - 120)),
    });
  };

  return (
    <div ref={box} className="relative h-full w-full" onPointerLeave={() => setHover(null)} data-histogram-strips={strips.length}>
      <PlotlyChart data={data} layout={layout} onHover={onHover} onUnhover={() => setHover(null)} />
      {hover && (
        <StepTooltip
          style={{ left: hover.left, top: hover.top }}
          strip={strips[hover.strip]!}
          labelled={labels}
          tip={hover.tip}
          edges={edges}
          xAxis={xAxis}
        />
      )}
    </div>
  );
}

const centre = (edges: readonly number[], b: number) =>
  Number.isFinite(b) && b >= 0 && b < edges.length - 1 ? (edges[b]! + edges[b + 1]!) / 2 : null;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The hovered step's histogram of one strip: a small bar chart, the step, the hovered bin's count. */
function StepTooltip({
  strip, labelled, tip, edges, xAxis, style,
}: {
  strip: Strip;
  labelled: boolean;
  tip: StripTooltip;
  edges: number[];
  xAxis: HistogramXAxis;
  style: CSSProperties;
}) {
  const W = 180;
  const H = 56;
  const peak = Math.max(1e-12, ...tip.counts);
  const bw = W / Math.max(1, tip.counts.length);
  const bin = tip.bin;
  return (
    <div
      className="pointer-events-none absolute z-20 w-[200px] rounded border border-border bg-bg-elevated px-2 py-1.5 text-[11px] shadow-lg"
      style={style}
      data-histogram-tooltip
    >
      {labelled && (
        <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-fg-muted">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: strip.color }} />
          <span className="mono truncate">{strip.label}</span>
        </div>
      )}
      <div className="font-semibold">
        Step: <span className="mono tabular-nums">{tip.step}</span>
        {xAxis === "relative_time" && <span className="ml-1 font-normal text-fg-muted">({formatNum(tip.x)} s)</span>}
        {xAxis === "wall_time" && <span className="ml-1 font-normal text-fg-muted">{new Date(tip.x).toLocaleString()}</span>}
      </div>
      <svg width={W} height={H} className="mt-1 block" aria-label="the step's histogram">
        {tip.counts.map((c, b) => {
          const h = (c / peak) * (H - 2);
          return (
            <rect
              key={b}
              x={b * bw}
              y={H - h}
              width={Math.max(0.5, bw - 0.3)}
              height={h}
              fill={b === bin ? "var(--color-fg, #111)" : strip.color}
              opacity={b === bin ? 0.9 : 0.75}
            />
          );
        })}
      </svg>
      <div className="mono mt-0.5 flex justify-between text-[10px] text-fg-muted">
        <span>{formatNum(edges[0]!)}</span>
        <span>{formatNum(edges[edges.length - 1]!)}</span>
      </div>
      {bin >= 0 && (
        <div className="mono text-[10px] text-fg-muted">
          [{formatNum(edges[bin]!)}, {formatNum(edges[bin + 1]!)}) · {Math.round(tip.counts[bin]!)} of {Math.round(tip.total)}
        </div>
      )}
    </div>
  );
}

/** One step's histograms of several strips, overlaid as bars on the shared grid. */
export function HistogramStripBars({
  edges, bars, logY,
}: {
  edges: number[];
  bars: Array<{ label: string; color: string; counts: number[] }>;
  logY: boolean;
}) {
  const data = useMemo<PlotlyData>(() => {
    const x = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]!) / 2);
    const width = edges.slice(0, -1).map((e, i) => edges[i + 1]! - e);
    return bars.map((b) => ({
      type: "bar",
      name: b.label,
      x,
      y: b.counts,
      width,
      opacity: bars.length > 1 ? 0.55 : 1,
      marker: { color: b.color, line: { width: 0 } },
      hovertemplate: `${bars.length > 1 ? `${escapeHtml(b.label)}<br>` : ""}value %{x:.4g}<br>count %{y:.4g}<extra></extra>`,
    }));
  }, [edges, bars]);
  const layout = useMemo<PlotlyLayout>(() => ({
    bargap: 0,
    barmode: "overlay",
    showlegend: bars.length > 1,
    legend: { orientation: "h", y: -0.25, font: { size: 10 } },
    xaxis: { title: { text: "value" } },
    yaxis: { title: { text: "count" }, type: logY ? "log" : "linear" },
  }), [logY, bars.length]);
  return <PlotlyChart data={data} layout={layout} />;
}
