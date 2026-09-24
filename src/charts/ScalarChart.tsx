import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import type { AxisSource } from "../lib/plot-utils/x-axis.ts";
import { formatNum, type AxisScale, type Series, type SeriesPoint } from "../lib/plot-utils/types.ts";
import { alignSeries, type DrawnSeries } from "./scalar-data.ts";
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
  xScale: AxisScale;
  yScale: AxisScale;
  /** Fixed axis bounds from settings; null ends stay automatic. */
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  /** Zoomed viewport (drag-to-zoom); takes precedence over x/yRange. */
  view: ScalarView;
  onViewChange?: (view: ScalarView) => void;
  smoothing: number;
  outlierPct: [number, number];
  lineType: LineType;
  showLegend: boolean;
  tooltip: { showContext: boolean; showWallTime: boolean };
  className?: string;
}

const EMPTY_VIEW: ScalarView = { xMin: null, xMax: null, yMin: null, yMax: null };
const MAX_TOOLTIP_ROWS = 12;

function pathsFor(lineType: LineType): uPlot.Series.PathBuilder {
  const { linear, spline, stepped } = uPlot.paths;
  if (lineType === "monotone") return spline!();
  if (lineType === "step" || lineType === "stepAfter") return stepped!({ align: 1 });
  if (lineType === "stepBefore") return stepped!({ align: -1 });
  return linear!();
}

function formatX(x: number, xAxis: AxisSource): string {
  if (xAxis === "wall_time") return new Date(x).toLocaleString();
  if (xAxis === "relative_time") return `${formatNum(x)} s`;
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
    series, xAxis, xScale, yScale, xRange, yRange, view, smoothing, outlierPct,
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
    () => alignSeries(series, { smoothing, outlierPct, xScale, yScale }),
    [series, smoothing, outlierPct, xScale, yScale],
  );
  const lines = aligned.lines;

  const data = useMemo<uPlot.AlignedData>(
    () => [aligned.xs, ...lines.map((l) => l.points.map((p) => (p ? p.y : null)))],
    [aligned, lines],
  );

  // Anything that changes the uPlot options (not just the data) rebuilds the chart.
  const structureKey = [
    xAxis, xScale, yScale, lineType, interactive,
    lines.map((l) => `${l.key}:${l.raw}:${l.color}`).join(","),
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

    const opts: uPlot.Options = {
      width: Math.max(host.clientWidth, 50),
      height: Math.max(host.clientHeight, 50),
      ms: 1,
      legend: { show: false },
      cursor: interactive
        ? {
          drag: { x: true, y: false, setScale: false },
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
      series: [
        {},
        ...lines.map((l): uPlot.Series => {
          return {
            label: l.label,
            stroke: withAlpha(l.color, l.raw ? 0.25 : 1),
            width: l.raw ? 1 : 1.5,
            spanGaps: true,
            paths: pathsFor(lineType),
            points: { show: false },
          };
        }),
      ],
      hooks: {
        setSelect: [
          (u) => {
            if (u.select.width < 4) return;
            const xMin = u.posToVal(u.select.left, "x");
            const xMax = u.posToVal(u.select.left + u.select.width, "x");
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            live.current.props.onViewChange?.({ xMin, xMax, yMin: null, yMax: null });
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
        setSeries: [(_u, seriesIdx) => setFocused(seriesIdx ?? null)],
      },
    };

    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;

    const onDblClick = () => live.current.props.onViewChange?.(EMPTY_VIEW);
    if (interactive) plot.over.addEventListener("dblclick", onDblClick);

    // uPlot only listens to the mouse. On touch (while interactive): drag
    // horizontally to zoom, tap to show the tooltip, double-tap to reset.
    let touchX0: number | null = null;
    let lastTap = 0;
    const overX = (t: Touch) => t.clientX - plot.over.getBoundingClientRect().left;
    const onTouchStart = (e: TouchEvent) => {
      touchX0 = e.touches.length === 1 ? overX(e.touches[0]!) : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (touchX0 == null || e.touches.length !== 1) return;
      e.preventDefault();
      const x = overX(e.touches[0]!);
      plot.setSelect({ left: Math.min(touchX0, x), width: Math.abs(x - touchX0), top: 0, height: plot.over.clientHeight }, false);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchX0 == null) return;
      const touch = e.changedTouches[0]!;
      const x = overX(touch);
      const width = Math.abs(x - touchX0);
      plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
      if (width >= 8) {
        const left = Math.min(touchX0, x);
        live.current.props.onViewChange?.({
          xMin: plot.posToVal(left, "x"), xMax: plot.posToVal(left + width, "x"), yMin: null, yMax: null,
        });
      } else {
        if (e.timeStamp - lastTap < 300) live.current.props.onViewChange?.(EMPTY_VIEW);
        else plot.setCursor({ left: x, top: touch.clientY - plot.over.getBoundingClientRect().top });
        lastTap = e.timeStamp;
      }
      touchX0 = null;
    };
    if (interactive) {
      plot.over.addEventListener("touchstart", onTouchStart, { passive: true });
      plot.over.addEventListener("touchmove", onTouchMove, { passive: false });
      plot.over.addEventListener("touchend", onTouchEnd);
    }

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: Math.max(host.clientWidth, 50), height: Math.max(host.clientHeight, 50) });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
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
            header={formatX(aligned.xs[hover.idx]!, xAxis)}
            rows={rows}
            focusedKey={focusedKey}
            tooltip={tooltip}
          />
        )}
      </div>
      {showLegend && series.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 pt-1 text-[10px] text-fg-muted">
          {series.map((s) => (
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
}

function tooltipRows(lines: DrawnSeries[], idx: number): TooltipRow[] {
  const rows: TooltipRow[] = [];
  for (const l of lines) {
    if (l.raw) continue;
    const point = nearestPoint(l.points, idx);
    if (point) rows.push({ key: l.key, label: l.label, color: l.color, point });
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
          <span className="mono ml-auto pl-2 text-fg">{formatNum(r.point.y)}</span>
        </div>
      ))}
      {rows.length > shown.length && <div className="text-fg-subtle">+{rows.length - shown.length} more</div>}
      {tooltip.showWallTime && shown[0]?.point.wallTime && (
        <div className="mono mt-0.5 text-fg-subtle">{new Date(shown[0].point.wallTime).toLocaleString()}</div>
      )}
    </div>
  );
}
