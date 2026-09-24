/** Plain data shapes shared by the chart cards. */

export interface SeriesPoint {
  x: number;
  y: number;
  wallTime?: string;
  context?: string | null;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  points: SeriesPoint[];
  rawPoints?: SeriesPoint[] | null;
}

export type AxisScale = "linear" | "log";

export interface PlotlyFigureLike {
  data?: Array<Record<string, unknown>>;
  layout?: Record<string, unknown>;
}

export const SERIES_COLORS = ["#0969da", "#d29922", "#3fb950", "#f85149", "#c678dd", "#56d4dd"];

export function seriesColor(index: number): string {
  const n = SERIES_COLORS.length;
  return SERIES_COLORS[((index % n) + n) % n]!;
}

export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(4)).toString();
}
