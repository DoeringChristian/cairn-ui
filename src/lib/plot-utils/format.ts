/**
 * How a number or a logged value reads wherever values are listed: the run
 * page's metrics and config, the runs table, run comparisons, sweep trials,
 * table cells, slider keys and chart tooltips. One format everywhere. Pure.
 */

/**
 * A number, short: integers exactly (a step of 12345 stays 12345), other
 * numbers to 4 significant digits (0.000123456 → 0.0001235).
 */
export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return Number(value.toPrecision(4)).toString();
}

/**
 * A y-axis tick label: `formatNum`, so ticks of small values keep their
 * digits (uPlot's default rounds to 3 decimals: 0.0001 read "0"). An empty
 * label for a missing split; -0 reads "0".
 */
export function axisTickLabel(value: number | null): string {
  if (value == null) return "";
  return value === 0 ? "0" : formatNum(value);
}

export interface FormatValueOptions {
  /** Shown for null / undefined (default "—"). */
  empty?: string;
  /** Numbers in full (a config value is what was set, not a measurement to round). */
  exact?: boolean;
}

/**
 * A logged value (a metric, a config value, a table cell): `empty` for
 * null/undefined, numbers by `formatNum` (in full with `exact`), booleans as
 * true/false, strings as they are, anything else as compact JSON.
 */
export function formatValue(value: unknown, { empty = "—", exact = false }: FormatValueOptions = {}): string {
  if (value === null || value === undefined) return empty;
  if (typeof value === "number") return exact ? String(value) : formatNum(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * A config value as the server stores it (a JSON string) decoded for
 * display and comparison: strings, numbers, booleans and null as themselves;
 * a list or mapping stays its compact JSON text (so equal values compare
 * equal); text that is not JSON as is.
 */
export function decodeConfigValue(raw: string): string | number | boolean | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}
