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
  /**
   * How the series is drawn (default "line"). A group's band edges are
   * "bandHi"/"bandLo" and share the key of their mean line; "member" is one
   * run of a group, drawn faded under the mean and left out of legend and
   * tooltip.
   */
  role?: SeriesRole;
  /** The run the series belongs to (none for a group's mean and band). */
  runId?: string;
}

export type SeriesRole = "line" | "member" | "bandHi" | "bandLo";

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
