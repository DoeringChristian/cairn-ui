/**
 * Deltas against the baseline run, coloured better or worse.
 *
 * Which way is better comes from the column's own `better` setting when the
 * user set one, else from the metric's summary rule (`run.stats[key].rule`
 * as the server reports it): `min` means lower is better, `max` higher.
 * Any other rule (mean, last, none) has no direction, and the delta is shown
 * uncoloured.
 */

import type { Run } from "../../api/types.ts";
import { columnKind, type Better } from "./columns.ts";

export type Tone = "better" | "worse" | "same" | "neutral";

/** The better direction a summary rule implies (null = no direction). */
export function betterFromRule(rule: string | null | undefined): Better | null {
  if (rule === "min") return "lower";
  if (rule === "max") return "higher";
  return null;
}

/**
 * A column's better direction: the explicit setting, else (for a metric
 * column) the baseline's summary rule for the metric, else any run's.
 */
export function betterFor(
  col: string,
  override: Better | undefined,
  baseline: Run | undefined,
  runs: readonly Run[],
): Better | null {
  if (override) return override;
  const { kind, key } = columnKind(col);
  if (kind !== "value") return null;
  const fromBaseline = betterFromRule(baseline?.stats?.[key]?.rule);
  if (fromBaseline) return fromBaseline;
  for (const r of runs) {
    const b = betterFromRule(r.stats?.[key]?.rule);
    if (b) return b;
  }
  return null;
}

/** `value − baseline` for two finite numbers (bools as 0/1), else null. */
export function deltaOf(value: unknown, baseline: unknown): number | null {
  const a = typeof value === "boolean" ? Number(value) : value;
  const b = typeof baseline === "boolean" ? Number(baseline) : baseline;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

export function toneOf(delta: number | null, better: Better | null): Tone {
  if (delta === null) return "neutral";
  if (delta === 0) return "same";
  if (!better) return "neutral";
  return (delta < 0) === (better === "lower") ? "better" : "worse";
}

/** `+0.0123`, `-4.5e-5`: a signed, compact delta. */
export function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  const s = abs === 0 ? "0" : abs >= 1e5 || abs < 1e-3 ? abs.toExponential(2) : String(Number(abs.toPrecision(4)));
  return `${sign}${s}`;
}

/** The delta relative to the baseline's magnitude, e.g. `-12.5%`; null when undefined. */
export function relativeDelta(delta: number | null, baseline: unknown): number | null {
  if (delta === null || typeof baseline !== "number" || baseline === 0 || !Number.isFinite(baseline)) return null;
  return delta / Math.abs(baseline);
}
