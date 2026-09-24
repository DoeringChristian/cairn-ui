import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { AxisSource } from "../lib/plot-utils/x-axis.ts";
import { formatNum, type AxisScale, type Series, type SeriesPoint } from "../lib/plot-utils/types.ts";
import { alignSeries, type DrawnSeries } from "./scalar-data.ts";
import type { SmoothingKind } from "../lib/plot-utils/smooth.ts";
import { onPrintLayout } from "../lib/print-layout.ts";
import { readChartTheme, withAlpha } from "./theme.ts";
import { useInteract } from "../lib/use-interact.ts";

export type LineType = "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";

export interface ScalarView {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

export interface ScalarChartProps {
  series: Series[];
  xAxis: AxisSource;
  /** The x-metric's name for `xAxis: "metric"` (tooltip header). */
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
  showLegend: boolean;
  tooltip: { showContext: boolean; showWallTime: boolean };
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

function formatX(x: number, xAxis: AxisSource, xLabel?: string): string {
  if (xAxis === "wall_time") return new Date(x).toLocaleString();
  if (xAxis === "relative_time") return `${formatNum(x)} s`;
  if (xAxis === "metric") return xLabel ? `${xLabel} ${formatNum(x)}` : formatNum(x);
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

interface Hover {
  idx: number;
  left: number;
  top: number;
}

/**
 * Multi-series line chart on uPlot. Self-contained: sizes itself to its box,
 * owns hover/tooltip, and reports drag-zoom through `onViewChange` (the card
 * persists the viewport; double-click resets it). While not interactive (a
 * touch device with the card's interact toggle off, see lib/use-interact) the
 * cursor is off, so no listeners are installed and the page scrolls through.
 */
export default function ScalarChart(props: ScalarChartProps) {
  const {
    series, xAxis, xScale, yScale, xRange, yRange, view, smoothing, smoothingKind, outlierPct,
    lineType, showLegend, tooltip, className,
  } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const plotHostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const interactive = useInteract();

  // Callbacks and bounds read at event time, so they never force a rebuild.
  const live = useRef({ props });
  live.current = { props };

  const aligned = useMemo(
    () => alignSeries(series, { smoothing, smoothingKind, outlierPct, xScale, yScale }),
    [series, smoothing, smoothingKind, outlierPct, xScale, yScale],
  );
  const lines = aligned.lines;

  const data = useMemo<uPlot.AlignedData>(
    () => [aligned.xs, ...lines.map((l) => l.points.map((p) => (p ? p.y : null)))],
    [aligned, lines],
  );

  // Anything that changes the uPlot options (not just the data) rebuilds the chart.
  const structureKey = [
    xAxis, xScale, yScale, lineType, interactive,
    lines.map((l) => `${l.key}:${l.role}:${l.color}`).join(","),
  ].join("|");

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) return;
    const theme = readChartTheme(host);
    const axis = (): uPlot.Axis => ({
      stroke: theme.fgMuted,
      grid: { stroke: theme.grid, width: 1 },
      ticks: { stroke: theme.grid, width: 1 },
      font: `10px ${theme.mono}`,
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

    // Each group's band fills between its hi and lo edges (1-based: 0 is x).
    const bands: uPlot.Band[] = [];
    lines.forEach((l, i) => {
      if (l.role !== "bandHi") return;
      const lo = lines.findIndex((o) => o.role === "bandLo" && o.key === l.key);
      if (lo >= 0) bands.push({ series: [i + 1, lo + 1], fill: withAlpha(l.color, 0.18) });
    });

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
        }
        : { show: false },
      focus: { alpha: 1 },
      scales: {
        x: {
          time: xAxis === "wall_time",
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
      axes: [axis(), { ...axis(), size: 56 }],
      bands,
      series: [
        {},
        ...lines.map((l): uPlot.Series => {
          const edge = l.role === "bandHi" || l.role === "bandLo";
          const faded = l.role === "raw" || l.role === "member";
          return {
            label: l.label,
            stroke: withAlpha(l.color, edge ? 0 : faded ? 0.25 : 1),
            width: edge ? 0 : faded ? 1 : 1.5,
            spanGaps: true,
            paths: pathsFor(lineType),
            points: { show: false },
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
        // A band edge focuses its group's mean line.
        setSeries: [(_u, seriesIdx) => setFocused(seriesIdx == null ? null : parentLine(lines, seriesIdx))],
      },
    };

    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const onDblClick = () => live.current.props.onViewChange?.(EMPTY_VIEW);
    if (interactive) plot.over.addEventListener("dblclick", onDblClick);

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
    };
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
    // `data` is pushed by the effect below; rebuilding on it would drop hover state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // New data, zoom or fixed bounds: re-run the range functions against fresh data.
  useEffect(() => {
    plotRef.current?.setData(data, true);
  }, [data, view.xMin, view.xMax, view.yMin, view.yMax, xRange[0], xRange[1], yRange[0], yRange[1]]);

  const rows = hover ? tooltipRows(lines, hover.idx) : [];
  // One entry per line: members and band edges belong to their group's mean.
  const legend = series.filter((s) => (s.role ?? "line") === "line");
  const focusedKey = focused != null && focused > 0 ? lines[focused - 1]?.key : undefined;

  return (
    <div ref={boxRef} className={`flex flex-col min-h-0 ${className ?? ""}`}>
      <div
        className="relative flex-1 min-h-0"
        style={{ touchAction: interactive ? "none" : "pan-y" }}
        onMouseLeave={() => setHover(null)}
      >
        <div ref={plotHostRef} className="absolute inset-0" />
        {hover && rows.length > 0 && (
          <ChartTooltip
            hover={hover}
            boxWidth={plotHostRef.current?.clientWidth ?? 0}
            boxHeight={plotHostRef.current?.clientHeight ?? 0}
            header={formatX(aligned.xs[hover.idx]!, xAxis, props.xLabel)}
            rows={rows}
            focusedKey={focusedKey}
            tooltip={tooltip}
          />
        )}
      </div>
      {showLegend && legend.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 pt-1 text-[10px] text-fg-muted">
          {legend.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
              <span className="truncate max-w-[16rem]">{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface TooltipRow {
  key: string;
  label: string;
  color: string;
  point: SeriesPoint;
  /** A group's band edges at this x, shown after the mean. */
  band?: [number, number];
}

/** uPlot series index (1-based) → the index of the line it belongs to. */
function parentLine(lines: DrawnSeries[], seriesIdx: number): number {
  const l = lines[seriesIdx - 1];
  if (!l || (l.role !== "bandHi" && l.role !== "bandLo")) return seriesIdx;
  const parent = lines.findIndex((o) => o.role === "line" && o.key === l.key);
  return parent >= 0 ? parent + 1 : seriesIdx;
}

function tooltipRows(lines: DrawnSeries[], idx: number): TooltipRow[] {
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
    const point = nearestPoint(l.points, idx);
    if (!point) continue;
    const e = edges.get(l.key);
    const band = e?.lo != null && e.hi != null ? ([e.lo, e.hi] as [number, number]) : undefined;
    rows.push({ key: l.key, label: l.label, color: l.color, point, band });
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
  tooltip: { showContext: boolean; showWallTime: boolean };
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
          {tooltip.showContext && r.point.context ? <span className="text-fg-subtle">{r.point.context}</span> : null}
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
