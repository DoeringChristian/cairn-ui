import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import { formatNum, type AxisScale, type Series, type SeriesPoint } from "../lib/plot-utils/types.ts";
import { alignSeries, type DrawnSeries } from "./scalar-data.ts";
import type { SmoothingKind } from "../lib/plot-utils/smooth.ts";
import type { StackMode } from "../lib/plot-utils/stack.ts";
import { onPrintLayout } from "../lib/print-layout.ts";
import { readChartTheme, withAlpha } from "./theme.ts";
import { useInteract } from "../lib/use-interact.ts";

export type LineType = "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";

/** How x values read: a step, a date (epoch ms), seconds, or a plain value. */
export type XKind = "step" | "wall_time" | "relative_time" | "value";

export interface ScalarView {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

/** A line's look beyond its colour (which the series carries). */
export interface LineStyle {
  width?: number;
  dash?: "solid" | "dashed" | "dotted";
}

export interface ScalarChartProps {
  series: Series[];
  xKind: XKind;
  /** The x expression (tooltip header for a value axis). */
  xLabel?: string;
  xScale: AxisScale;
  yScale: AxisScale;
  /** Fixed axis bounds from settings; null ends stay automatic. */
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  /** Zoomed viewport (drag-to-zoom); takes precedence over x/yRange. */
  view: ScalarView;
  onViewChange?: (view: ScalarView) => void;
  smoothing: number;
  smoothingKind: SmoothingKind;
  outlierPct: [number, number];
  lineType: LineType;
  showOriginal: boolean;
  stack: StackMode;
  /** Min/max bucketing per pixel of the visible x range. */
  fullFidelity: boolean;
  legend: { show: boolean; position: "bottom" | "top" | "right" };
  tooltip: { showWallTime: boolean };
  /** Tooltip label per line key (the tooltip template); else the line's label. */
  tooltipLabels?: ReadonlyMap<string, string>;
  axisTitles: { x: string; y: string };
  /** Width / dash per line key. */
  styles?: Readonly<Record<string, LineStyle>>;
  /** The baseline run: drawn wider, dashed while hovered. */
  baselineRunId?: string | null;
  /** Share the hover cursor with other charts of this key (uPlot `cursor.sync`). */
  cursorSyncKey?: string | null;
  /** Cmd/Ctrl-click on a run's line. */
  onOpenRun?: (runId: string) => void;
  className?: string;
}

const EMPTY_VIEW: ScalarView = { xMin: null, xMax: null, yMin: null, yMax: null };
/** A drag that stays within this many px along one axis zooms only the other. */
const UNI_PX = 20;

interface SelectBox { left: number; top: number; width: number; height: number }

/**
 * The drag rectangle for a drag from (x0, y0) to (x1, y1) in plot-area px:
 * nearly-horizontal drags span the full height (x-only zoom), nearly-vertical
 * ones the full width (y-only zoom), anything else is a box.
 */
function selectBox(u: uPlot, x0: number, y0: number, x1: number, y1: number): SelectBox {
  const w = u.over.clientWidth;
  const h = u.over.clientHeight;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dy < UNI_PX && dx >= dy) return { left: Math.min(x0, x1), width: dx, top: 0, height: h };
  if (dx < UNI_PX) return { left: 0, width: w, top: Math.min(y0, y1), height: dy };
  return { left: Math.min(x0, x1), width: dx, top: Math.min(y0, y1), height: dy };
}

/**
 * The view a finished drag selects, or null for a click-sized drag. An x-only
 * drag lets y re-fit the visible data; a y-only drag keeps the current x view.
 */
function viewFromSelect(u: uPlot, sel: SelectBox, prev: ScalarView): ScalarView | null {
  const fullH = sel.height >= u.over.clientHeight - 1;
  const fullW = sel.width >= u.over.clientWidth - 1;
  if (fullH ? sel.width < 4 : fullW ? sel.height < 4 : sel.width < 4 && sel.height < 4) return null;
  const x = fullW
    ? { xMin: prev.xMin, xMax: prev.xMax }
    : { xMin: u.posToVal(sel.left, "x"), xMax: u.posToVal(sel.left + sel.width, "x") };
  const y = fullH
    ? { yMin: null, yMax: null }
    : { yMin: u.posToVal(sel.top + sel.height, "y"), yMax: u.posToVal(sel.top, "y") };
  return { ...x, ...y };
}
const MAX_TOOLTIP_ROWS = 12;

function pathsFor(lineType: LineType): uPlot.Series.PathBuilder {
  const { linear, spline, stepped } = uPlot.paths;
  if (lineType === "monotone") return spline!();
  if (lineType === "step" || lineType === "stepAfter") return stepped!({ align: 1 });
  if (lineType === "stepBefore") return stepped!({ align: -1 });
  return linear!();
}

function formatX(x: number, kind: XKind, xLabel?: string): string {
  if (kind === "wall_time") return new Date(x).toLocaleString();
  if (kind === "relative_time") return `${formatNum(x)} s`;
  if (kind === "value") return xLabel ? `${xLabel} = ${formatNum(x)}` : formatNum(x);
  return String(x);
}

/** Nearest sampled point to column `idx` (series are sparse on the shared x array). */
function nearestPoint(points: Array<SeriesPoint | null>, idx: number): SeriesPoint | null {
  if (points[idx]) return points[idx]!;
  for (let d = 1; d < 2000; d++) {
    const lo = points[idx - d];
    const hi = points[idx + d];
    if (lo) return lo;
    if (hi) return hi;
    if (idx - d < 0 && idx + d >= points.length) break;
  }
  return null;
}

const isEdge = (l: DrawnSeries) =>
  l.role === "bandHi" || l.role === "bandLo" || l.role === "envHi" || l.role === "envLo";
const isFaded = (l: DrawnSeries) => l.role === "raw" || l.role === "member";

const DASHES = { solid: [] as number[], dashed: [6, 4], dotted: [2, 3] };

interface Hover {
  idx: number;
  left: number;
  top: number;
}

/** What the draw-time stroke / fill functions read (updated without a rebuild). */
interface LiveStyle {
  strokes: string[];
  bandFills: string[];
  firstFill: string | null;
}

/**
 * Multi-series line chart on uPlot. Self-contained: sizes itself to its box,
 * owns hover/tooltip and its interactive legend (click highlights a line,
 * Alt-click isolates it), and reports drag-zoom through `onViewChange` (the
 * card persists the viewport; double-click resets it). Cmd/Ctrl-click on a
 * run's line calls `onOpenRun`. Colour, width, dash, highlight and hover
 * changes restyle the uPlot series in place; only a change of the lines, the
 * scales or the axes rebuilds it. While not interactive (a touch device with
 * the card's interact toggle off, see lib/use-interact) the cursor is off.
 */
export default function ScalarChart(props: ScalarChartProps) {
  const {
    series, xKind, xScale, yScale, xRange, yRange, view, smoothing, smoothingKind, outlierPct,
    lineType, showOriginal, stack, fullFidelity, legend, tooltip, axisTitles, className,
  } = props;
  const plotHostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const interactive = useInteract();

  // Callbacks and bounds read at event time, so they never force a rebuild.
  const live = useRef({ props, focused });
  live.current = { props, focused };

  // Full fidelity buckets the visible x range, one bucket per pixel.
  const bucketLo = view.xMin ?? xRange[0];
  const bucketHi = view.xMax ?? xRange[1];
  const bucket = useMemo(
    () =>
      fullFidelity && plotWidth > 0
        ? { lo: bucketLo, hi: bucketHi, buckets: Math.max(16, Math.round(plotWidth)) }
        : null,
    [fullFidelity, plotWidth, bucketLo, bucketHi],
  );

  const aligned = useMemo(
    () => alignSeries(series, { smoothing, smoothingKind, outlierPct, xScale, yScale, showOriginal, stack, bucket }),
    [series, smoothing, smoothingKind, outlierPct, xScale, yScale, showOriginal, stack, bucket],
  );
  const lines = aligned.lines;

  const data = useMemo<uPlot.AlignedData>(() => [aligned.xs, ...aligned.ys], [aligned]);

  // One legend entry per line: members and band edges belong to their group's centre.
  const legendItems = useMemo(() => lines.filter((l) => l.role === "line"), [lines]);
  // A highlight or isolation of a line that is gone lapses.
  const keys = useMemo(() => new Set(legendItems.map((l) => l.key)), [legendItems]);
  const hl = highlight && keys.has(highlight) ? highlight : null;
  const iso = isolated && keys.has(isolated) ? isolated : null;

  const focusedLine = focused != null && focused > 0 ? lines[focused - 1] : undefined;
  const focusedKey = focusedLine?.key;
  const baseline = props.baselineRunId ?? null;

  /** Per line (uPlot series i + 1): stroke colour, width, dash, shown. */
  const style = useMemo(() => {
    const styles = props.styles ?? {};
    return lines.map((l) => {
      const own = styles[l.key] ?? {};
      const isBaseline = baseline != null && l.runId === baseline && l.role === "line";
      const dimmed = hl != null && l.key !== hl;
      const edge = isEdge(l);
      const faded = isFaded(l);
      const alpha = edge ? 0 : (faded ? 0.25 : 1) * (dimmed ? 0.2 : 1);
      const width = edge ? 0 : faded ? 1 : (own.width ?? (isBaseline ? 3 : 1.5)) + (l.key === hl ? 1 : 0);
      const hoveredBaseline = isBaseline && l.key === focusedKey;
      const dash = hoveredBaseline ? DASHES.dashed : !faded && own.dash ? DASHES[own.dash] : DASHES.solid;
      const show = iso == null || l.key === iso;
      return { stroke: withAlpha(l.color, alpha), width, dash, show };
    });
  }, [lines, props.styles, baseline, hl, iso, focusedKey]);

  // Each band / envelope / stacked area fills between its two edges (1-based: 0 is x).
  const bandPairs = useMemo(() => {
    const pairs: Array<{ hi: number; lo: number; color: string; alpha: number }> = [];
    if (stack !== "none") {
      for (let i = 1; i < lines.length; i++) {
        pairs.push({ hi: i + 1, lo: i, color: lines[i]!.color, alpha: 0.35 });
      }
      return pairs;
    }
    lines.forEach((l, i) => {
      if (l.role !== "bandHi" && l.role !== "envHi") return;
      const loRole = l.role === "bandHi" ? "bandLo" : "envLo";
      const lo = lines.findIndex((o) => o.role === loRole && o.key === l.key);
      if (lo >= 0) pairs.push({ hi: i + 1, lo: lo + 1, color: l.color, alpha: l.role === "bandHi" ? 0.18 : 0.12 });
    });
    return pairs;
  }, [lines, stack]);

  const liveStyle = useRef<LiveStyle>({ strokes: [], bandFills: [], firstFill: null });
  liveStyle.current = {
    strokes: style.map((s) => s.stroke),
    bandFills: bandPairs.map((b) => {
      const l = lines[b.hi - 1];
      const dim = hl != null && l != null && l.key !== hl;
      return withAlpha(b.color, b.alpha * (dim ? 0.3 : 1));
    }),
    firstFill:
      stack !== "none" && lines[0]
        ? withAlpha(lines[0].color, 0.35 * (hl != null && lines[0].key !== hl ? 0.3 : 1))
        : null,
  };

  // Anything that changes the uPlot options (not just data or style) rebuilds the chart.
  const syncKey = props.cursorSyncKey ?? null;
  const structureKey = [
    xKind, xScale, yScale, lineType, interactive, stack, syncKey, axisTitles.x, axisTitles.y,
    lines.map((l) => `${l.key}:${l.role}`).join(","),
  ].join("|");

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) return;
    const theme = readChartTheme(host);
    const axis = (label: string): uPlot.Axis => ({
      stroke: theme.fgMuted,
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.grid, width: 1 },
      font: `10px ${theme.mono}`,
      ...(label ? { label, labelSize: 16, labelFont: `11px ${theme.mono}` } : {}),
    });

    const autoRange = (
      scale: AxisScale,
      fixed: [number | null, number | null],
      zoom: [number | null, number | null],
      pad: boolean,
    ): uPlot.Range.Function => (_u, dataMin, dataMax) => {
      let [lo, hi]: [number | null, number | null] =
        scale === "log"
          ? uPlot.rangeLog(dataMin ?? 1, dataMax ?? 10, 10, false)
          : pad
            ? uPlot.rangeNum(dataMin ?? 0, dataMax ?? 1, 0.1, true)
            : [dataMin, dataMax];
      if (lo === hi && lo != null) [lo, hi] = [lo - 0.5, hi! + 0.5];
      const lo2 = zoom[0] ?? fixed[0] ?? lo;
      const hi2 = zoom[1] ?? fixed[1] ?? hi;
      return [lo2, hi2];
    };

    const bands: uPlot.Band[] = bandPairs.map((b, bi) => ({
      series: [b.hi, b.lo],
      fill: () => liveStyle.current.bandFills[bi] ?? "transparent",
    }));

    const opts: uPlot.Options = {
      width: Math.max(host.clientWidth, 50),
      height: Math.max(host.clientHeight, 50),
      ms: 1,
      legend: { show: false },
      cursor: interactive
        ? {
          drag: { x: true, y: true, uni: UNI_PX, setScale: false },
          focus: { prox: 16 },
          points: { size: 6 },
          ...(syncKey ? { sync: { key: syncKey, setSeries: false } } : {}),
        }
        : { show: false },
      focus: { alpha: 1 },
      scales: {
        x: {
          time: xKind === "wall_time",
          distr: xScale === "log" ? 3 : 1,
          range: (u, mn, mx) => {
            const { view: v, xRange: r, xScale: s } = live.current.props;
            return autoRange(s, r, [v.xMin, v.xMax], false)(u, mn, mx, "x");
          },
        },
        y: {
          distr: yScale === "log" ? 3 : 1,
          range: (u, mn, mx) => {
            const { view: v, yRange: r, yScale: s } = live.current.props;
            return autoRange(s, r, [v.yMin, v.yMax], true)(u, mn, mx, "y");
          },
        },
      },
      axes: [axis(axisTitles.x), { ...axis(axisTitles.y), size: 56 }],
      bands,
      series: [
        {},
        ...lines.map((l, i): uPlot.Series => {
          const st = style[i]!;
          return {
            label: l.label,
            stroke: (_u, si) => liveStyle.current.strokes[si - 1] ?? "transparent",
            width: st.width,
            dash: st.dash,
            show: st.show,
            spanGaps: true,
            paths: pathsFor(lineType),
            points: { show: false },
            // A stacked chart's bottom area fills down to zero.
            ...(stack !== "none" && i === 0
              ? { fill: () => liveStyle.current.firstFill ?? "transparent", fillTo: 0 }
              : {}),
          };
        }),
      ],
      hooks: {
        setSelect: [
          (u) => {
            const next = viewFromSelect(u, u.select, live.current.props.view);
            if (!next) return;
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            live.current.props.onViewChange?.(next);
          },
        ],
        setCursor: [
          (u) => {
            const { idx, left, top } = u.cursor;
            if (idx == null || left == null || top == null || left < 0) {
              setHover(null);
              return;
            }
            setHover({ idx, left: left + u.over.offsetLeft, top: top + u.over.offsetTop });
          },
        ],
        // A band edge focuses its group's line.
        setSeries: [(_u, seriesIdx) => setFocused(seriesIdx == null ? null : parentLine(lines, seriesIdx))],
      },
    };

    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const onDblClick = () => live.current.props.onViewChange?.(EMPTY_VIEW);
    // Cmd/Ctrl-click opens the run of the hovered line.
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const f = live.current.focused;
      const l = f != null && f > 0 ? lines[f - 1] : undefined;
      if (l?.runId) live.current.props.onOpenRun?.(l.runId);
    };
    if (interactive) {
      plot.over.addEventListener("dblclick", onDblClick);
      plot.over.addEventListener("click", onClick);
    }

    // uPlot only listens to the mouse. On touch (while interactive): drag to
    // zoom (same x-only / y-only / box rule as the mouse), tap to show the
    // tooltip, double-tap to reset.
    let touch0: { x: number; y: number } | null = null;
    let lastTap = 0;
    const overPos = (t: Touch) => {
      const r = plot.over.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const onTouchStart = (e: TouchEvent) => {
      touch0 = e.touches.length === 1 ? overPos(e.touches[0]!) : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touch0 == null || e.touches.length !== 1) return;
      e.preventDefault();
      const p = overPos(e.touches[0]!);
      plot.setSelect(selectBox(plot, touch0.x, touch0.y, p.x, p.y), false);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touch0 == null) return;
      const p = overPos(e.changedTouches[0]!);
      const moved = Math.max(Math.abs(p.x - touch0.x), Math.abs(p.y - touch0.y));
      plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
      if (moved >= 8) {
        const next = viewFromSelect(plot, selectBox(plot, touch0.x, touch0.y, p.x, p.y), live.current.props.view);
        if (next) live.current.props.onViewChange?.(next);
      } else {
        if (e.timeStamp - lastTap < 300) live.current.props.onViewChange?.(EMPTY_VIEW);
        else plot.setCursor({ left: p.x, top: p.y });
        lastTap = e.timeStamp;
      }
      touch0 = null;
    };
    if (interactive) {
      plot.over.addEventListener("touchstart", onTouchStart, { passive: true });
      plot.over.addEventListener("touchmove", onTouchMove, { passive: false });
      plot.over.addEventListener("touchend", onTouchEnd);
    }

    const resize = () => {
      plot.setSize({ width: Math.max(host.clientWidth, 50), height: Math.max(host.clientHeight, 50) });
      setPlotWidth(plot.over.clientWidth);
    };
    setPlotWidth(plot.over.clientWidth);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const offPrint = onPrintLayout(resize);

    return () => {
      ro.disconnect();
      offPrint();
      plot.destroy();
      plotRef.current = null;
      setHover(null);
    };
    // `data` is pushed and the style applied by the effects below; rebuilding
    // on them would drop hover state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // Style, highlight, isolation and hover: restyle the series in place.
  // Colours and fills are read at draw time from `liveStyle`.
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    style.forEach((st, i) => {
      const s = u.series[i + 1];
      if (!s) return;
      if (s.show !== st.show) u.setSeries(i + 1, { show: st.show }, false);
      s.width = st.width;
      s.dash = st.dash;
    });
    u.redraw(false, false);
  }, [style, bandPairs]);

  // New data, zoom or fixed bounds: re-run the range functions against fresh data.
  useEffect(() => {
    plotRef.current?.setData(data, true);
  }, [data, view.xMin, view.xMax, view.yMin, view.yMax, xRange[0], xRange[1], yRange[0], yRange[1]]);

  const rows = hover ? tooltipRows(lines, hover.idx, props.tooltipLabels, iso) : [];

  const legendEl = legend.show && legendItems.length > 1 && (
    <ChartLegend
      items={legendItems}
      vertical={legend.position === "right"}
      highlight={hl}
      isolated={iso}
      onHighlight={(k) => setHighlight((cur) => (cur === k ? null : k))}
      onIsolate={(k) => setIsolated((cur) => (cur === k ? null : k))}
    />
  );

  return (
    <div className={`flex min-h-0 ${legend.position === "right" ? "flex-row" : "flex-col"} ${className ?? ""}`}>
      {legend.position === "top" && legendEl}
      <div
        className="relative flex-1 min-h-0 min-w-0"
        style={{ touchAction: interactive ? "none" : "pan-y" }}
        onMouseLeave={() => setHover(null)}
      >
        <div ref={plotHostRef} className="absolute inset-0" />
        {hover && rows.length > 0 && (
          <ChartTooltip
            hover={hover}
            boxWidth={plotHostRef.current?.clientWidth ?? 0}
            boxHeight={plotHostRef.current?.clientHeight ?? 0}
            header={formatX(aligned.xs[hover.idx]!, xKind, props.xLabel)}
            rows={rows}
            focusedKey={focusedKey}
            tooltip={tooltip}
          />
        )}
      </div>
      {legend.position !== "top" && legendEl}
    </div>
  );
}

/**
 * The chart's legend: click a line to highlight it (again to clear),
 * Alt-click to show only that line (again to show all).
 */
function ChartLegend({
  items, vertical, highlight, isolated, onHighlight, onIsolate,
}: {
  items: DrawnSeries[];
  vertical: boolean;
  highlight: string | null;
  isolated: string | null;
  onHighlight: (key: string) => void;
  onIsolate: (key: string) => void;
}) {
  return (
    <div
      className={
        vertical
          ? "flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto pl-2 text-[10px] text-fg-muted"
          : "flex flex-wrap gap-x-3 gap-y-0.5 px-1 pt-1 text-[10px] text-fg-muted"
      }
    >
      {items.map((s) => {
        const active = s.key === highlight || s.key === isolated;
        const off = (isolated != null && s.key !== isolated) || (highlight != null && s.key !== highlight);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            title="Click to highlight · Alt-click to show only this line"
            onClick={(e) => (e.altKey ? onIsolate(s.key) : onHighlight(s.key))}
            className={`inline-flex min-w-0 items-center gap-1 rounded px-0.5 text-left hover:text-fg ${
              off ? "opacity-40" : ""
            } ${active ? "font-semibold text-fg" : ""}`}
          >
            <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: s.color }} />
            <span className="truncate max-w-[16rem]">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface TooltipRow {
  key: string;
  label: string;
  color: string;
  point: SeriesPoint;
  /** A group's band edges at this x, shown after the centre. */
  band?: [number, number];
}

/** uPlot series index (1-based) → the index of the line it belongs to. */
function parentLine(lines: DrawnSeries[], seriesIdx: number): number {
  const l = lines[seriesIdx - 1];
  if (!l || !isEdge(l)) return seriesIdx;
  const parent = lines.findIndex((o) => o.role === "line" && o.key === l.key);
  return parent >= 0 ? parent + 1 : seriesIdx;
}

function tooltipRows(
  lines: DrawnSeries[],
  idx: number,
  labels: ReadonlyMap<string, string> | undefined,
  isolated: string | null,
): TooltipRow[] {
  const rows: TooltipRow[] = [];
  const edges = new Map<string, { lo?: number; hi?: number }>();
  for (const l of lines) {
    if (l.role !== "bandHi" && l.role !== "bandLo") continue;
    const y = nearestPoint(l.points, idx)?.y;
    const e = edges.get(l.key) ?? {};
    if (l.role === "bandHi") e.hi = y;
    else e.lo = y;
    edges.set(l.key, e);
  }
  for (const l of lines) {
    if (l.role !== "line") continue;
    if (isolated != null && l.key !== isolated) continue;
    const point = nearestPoint(l.points, idx);
    if (!point) continue;
    const e = edges.get(l.key);
    const band = e?.lo != null && e.hi != null ? ([e.lo, e.hi] as [number, number]) : undefined;
    rows.push({ key: l.key, label: labels?.get(l.key) ?? l.label, color: l.color, point, band });
  }
  rows.sort((a, b) => b.point.y - a.point.y);
  return rows;
}

/**
 * Beside the cursor, on the side with more room, then clamped (after
 * measuring, before paint) so it stays inside the plot box.
 */
function ChartTooltip({
  hover, boxWidth, boxHeight, header, rows, focusedKey, tooltip,
}: {
  hover: Hover;
  boxWidth: number;
  boxHeight: number;
  header: string;
  rows: TooltipRow[];
  focusedKey?: string;
  tooltip: { showWallTime: boolean };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const flip = hover.left > boxWidth / 2;
  const shown = rows.slice(0, MAX_TOOLTIP_ROWS);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = flip ? hover.left - 12 - w : hover.left + 12;
    el.style.left = `${Math.max(0, Math.min(left, boxWidth - w))}px`;
    el.style.top = `${Math.max(0, Math.min(hover.top - 8, boxHeight - h))}px`;
  });

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 rounded border border-border bg-bg-elevated/95 px-2 py-1 text-[10px] shadow-sm"
      style={{ maxWidth: `min(22rem, ${Math.max(boxWidth, 0)}px)` }}
    >
      <div className="mono mb-0.5 text-fg-muted">{header}</div>
      {shown.map((r) => (
        <div key={r.key} className={`flex items-center gap-1.5 ${r.key === focusedKey ? "font-semibold text-fg" : "text-fg-muted"}`}>
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="truncate">{r.label}</span>
          <span className="mono ml-auto pl-2 text-fg">
            {formatNum(r.point.y)}
            {r.band && <span className="text-fg-subtle">{` [${formatNum(r.band[0])}, ${formatNum(r.band[1])}]`}</span>}
          </span>
        </div>
      ))}
      {rows.length > shown.length && <div className="text-fg-subtle">+{rows.length - shown.length} more</div>}
      {tooltip.showWallTime && shown[0]?.point.wallTime && (
        <div className="mono mt-0.5 text-fg-subtle">{new Date(shown[0].point.wallTime).toLocaleString()}</div>
      )}
    </div>
  );
}
