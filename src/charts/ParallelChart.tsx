/**
 * Parallel coordinates, drawn as SVG: one vertical axis per column (label on
 * top: staggered on two rows and truncated when the axes are too close for
 * them, lib/parallel-coords.ts `axisLabels`, the full name in a tooltip;
 * top/bottom values or each category at the left of the axis), one
 * polyline per line through its positions (a missing position breaks the
 * line). Drag along an axis to brush it (a click clears it): lines outside
 * any brush are dimmed. Hovering a line shows its label and values and
 * reports it (`onHover`); `hot` highlights one line, dimming the others.
 *
 * Self-contained: it measures its own box (ResizeObserver).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { axisLabels, axisTicks, brushMatches, type AxisScale, type Brush } from "../lib/parallel-coords.ts";
import type { Scalar } from "../lib/summary-tables.ts";
import { formatValue } from "../lib/plot-utils/format.ts";

export interface ParallelChartAxis {
  label: string;
  scale: AxisScale;
}

export interface ParallelChartLine {
  key: string;
  label: string;
  color: string;
  /** Per axis: its position in [0, 1] (0 = bottom), null where the line skips the axis. */
  positions: Array<number | null>;
  /** Per axis: the value shown in the tooltip. */
  values: Scalar[];
}

interface Props {
  axes: ParallelChartAxis[];
  lines: ParallelChartLine[];
  brushes: ReadonlyMap<number, Brush>;
  onBrush: (axis: number, brush: Brush | null) => void;
  /** The highlighted line's key (hovered here or elsewhere), or null. */
  hot: string | null;
  onHover: (line: ParallelChartLine | null) => void;
  /** The plot's width (between the first and last axis' room), whenever it changes. */
  onSpan?: (span: number) => void;
  className?: string;
}

const PAD = { top: 30, bottom: 14, left: 56, right: 40 };
/** Labels on two rows: the plot starts this much lower. */
const SECOND_ROW = 13;

/** The plot's width in a box `w` px wide. */
export const plotSpan = (w: number) => Math.max(1, w - PAD.left - PAD.right);
const DIM = "rgb(var(--color-fg-subtle-rgb) / 0.18)";

function pathOf(xs: readonly number[], ys: ReadonlyArray<number | null>): string {
  let d = "";
  let open = false;
  ys.forEach((y, i) => {
    if (y == null) {
      open = false;
      return;
    }
    d += `${open ? "L" : "M"}${xs[i]!.toFixed(1)},${y.toFixed(1)}`;
    open = true;
  });
  return d;
}

/** A value as an axis or the tooltip shows it: small numbers in exponent form (`1e-5`, `3.7e-4`). */
function valueText(v: Scalar): string {
  if (typeof v === "number" && v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2).replace(/\.?0+e/, "e");
  return formatValue(v);
}

export default function ParallelChart({ axes, lines, brushes, onBrush, hot, onHover, onSpan, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  // Before paint: the card picks its axes for this width.
  useLayoutEffect(() => {
    if (w > 0) onSpan?.(plotSpan(w));
  }, [w, onSpan]);
  const xs = useMemo(() => {
    const n = axes.length;
    const span = plotSpan(w);
    return axes.map((_, i) => (n === 1 ? PAD.left + span / 2 : PAD.left + (i * span) / (n - 1)));
  }, [axes, w]);
  const labels = useMemo(() => axisLabels(axes.map((a) => a.label), xs, w), [axes, xs, w]);
  const top = PAD.top + (labels.some((l) => l.row === 1) ? SECOND_ROW : 0);
  const plotH = Math.max(1, h - top - PAD.bottom);
  const yOf = (p: number) => top + (1 - p) * plotH;
  // A drag within a few pixels of an axis end snaps to it, so the extreme lines can be brushed.
  const pOf = (y: number) => (y <= top + 4 ? 1 : y >= top + plotH - 4 ? 0 : 1 - (y - top) / plotH);

  // Brushing: the axis being dragged and where the drag started.
  const drag = useRef<{ axis: number; from: number; y0: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const svgY = (e: ReactPointerEvent) => e.clientY - (hostRef.current?.getBoundingClientRect().top ?? 0);
  const onAxisDown = (axis: number) => (e: ReactPointerEvent<SVGRectElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const y = svgY(e);
    drag.current = { axis, from: pOf(y), y0: y };
    setDragging(true);
    onHover(null);
    setTip(null);
  };
  const onAxisMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const d = drag.current;
    if (!d) return;
    const y = svgY(e);
    if (Math.abs(y - d.y0) >= 3) onBrush(d.axis, [Math.min(d.from, pOf(y)), Math.max(d.from, pOf(y))]);
  };
  const onAxisUp = (e: ReactPointerEvent<SVGRectElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && Math.abs(svgY(e) - d.y0) < 3) onBrush(d.axis, null);
  };

  const [tip, setTip] = useState<{ line: ParallelChartLine; x: number; y: number } | null>(null);
  // A line that is gone takes its tooltip with it.
  useEffect(() => {
    if (tip && !lines.some((l) => l.key === tip.line.key)) setTip(null);
  }, [lines, tip]);
  const lineMove = (line: ParallelChartLine) => (e: ReactPointerEvent<SVGPathElement>) => {
    if (drag.current) return;
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ line, x: e.clientX - r.left, y: e.clientY - r.top });
    if (tip?.line.key !== line.key) onHover(line);
  };
  const lineLeave = () => {
    setTip(null);
    onHover(null);
  };

  const drawn = useMemo(() => {
    const out = lines.map((l) => ({
      line: l,
      d: pathOf(xs, l.positions.map((p) => (p == null ? null : yOf(p)))),
      match: brushMatches(l.positions, brushes),
    }));
    // Dimmed lines below, the highlighted one on top.
    const rank = (x: (typeof out)[number]) => (x.line.key === hot ? 2 : x.match ? 1 : 0);
    return out.sort((a, b) => rank(a) - rank(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, xs, brushes, hot, plotH, top]);

  return (
    <div ref={hostRef} className={`relative select-none ${className ?? ""}`} data-testid="parallel-chart">
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="absolute inset-0 block text-fg-muted">
          {drawn.map(({ line, d, match }) => {
            const on = hot == null ? match : line.key === hot;
            return (
              <path
                key={line.key}
                d={d}
                fill="none"
                stroke={on ? line.color : DIM}
                strokeWidth={line.key === hot ? 2.5 : 1.5}
                strokeOpacity={on ? 0.9 : 1}
                strokeLinejoin="round"
                data-line={line.key}
                data-match={match ? "" : undefined}
              />
            );
          })}
          {/* Wide invisible strokes to hover the lines by. */}
          {!dragging &&
            drawn.map(({ line, d }) => (
              <path
                key={`hit:${line.key}`}
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={8}
                style={{ pointerEvents: "stroke", cursor: "default" }}
                onPointerMove={lineMove(line)}
                onPointerLeave={lineLeave}
              />
            ))}
          {axes.map((a, i) => {
            const x = xs[i]!;
            const b = brushes.get(i);
            return (
              <g key={`${a.label}:${i}`}>
                <line x1={x} x2={x} y1={yOf(1)} y2={yOf(0)} stroke="currentColor" strokeOpacity={0.6} />
                <text x={x} y={12 + labels[i]!.row * SECOND_ROW} textAnchor="middle" className="mono" fontSize={11} fill="rgb(var(--color-fg-rgb))">
                  {labels[i]!.text}
                  <title>{a.label}{a.scale.kind === "numeric" && a.scale.log ? " (log)" : ""}</title>
                </text>
                {axisTicks(a.scale).map((t) => (
                  <g key={`${t.at}`}>
                    <line x1={x - 4} x2={x} y1={yOf(t.at)} y2={yOf(t.at)} stroke="currentColor" strokeOpacity={0.6} />
                    <text x={x - 6} y={yOf(t.at)} dy="0.32em" textAnchor="end" fontSize={10} fill="currentColor" className="mono">
                      {valueText(t.value)}
                    </text>
                  </g>
                ))}
                {b && (
                  <rect
                    x={x - 6}
                    width={12}
                    y={yOf(b[1])}
                    height={Math.max(1, yOf(b[0]) - yOf(b[1]))}
                    fill="rgb(var(--color-accent-rgb) / 0.25)"
                    stroke="rgb(var(--color-accent-rgb))"
                    data-brush={i}
                  />
                )}
                <rect
                  x={x - 12}
                  width={24}
                  y={yOf(1) - 4}
                  height={plotH + 8}
                  fill="transparent"
                  style={{ cursor: "ns-resize", touchAction: "none" }}
                  data-axis={i}
                  onPointerDown={onAxisDown(i)}
                  onPointerMove={onAxisMove}
                  onPointerUp={onAxisUp}
                  onPointerCancel={onAxisUp}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 max-w-xs rounded border border-border bg-bg-elevated px-2 py-1 text-xs shadow-lg"
          style={{ left: Math.min(tip.x + 12, Math.max(0, w - 200)), top: Math.min(tip.y + 12, Math.max(0, h - 24 - 16 * axes.length)) }}
        >
          <div className="mb-0.5 flex items-center gap-1.5 font-medium">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tip.line.color }} />
            {tip.line.label}
          </div>
          {axes.map((a, i) => (
            <div key={`${a.label}:${i}`} className="flex justify-between gap-3">
              <span className="mono text-fg-muted">{a.label}</span>
              <span className="mono tabular-nums">{valueText(tip.line.values[i] ?? null)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
