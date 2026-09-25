/**
 * Colour runs by a value (wandb's key-based colours), pure. Each run's value
 * of the workspace's `prefs.colorBy.expr` goes into one of N buckets:
 *   - numbers: N evenly spaced buckets between the min and max over the
 *     runs given (all runs one value: one bucket);
 *   - text (any non-number among the values): one bucket per distinct
 *     value, the most common first, capped at N — beyond it the rest share
 *     an "other" bucket;
 *   - no value: a neutral grey.
 * Bucket colours are sampled evenly from the palette, inset from its ends
 * (turbo and magma end near black or white, which vanish on one theme).
 * `RunColorByProvider` (run-color-by-context.tsx) feeds `useRunColors`.
 */

import { sampleColormap } from "../charts/colormaps.ts";
import type { ColorByPalette } from "./workspace/doc.ts";

export type ColorByValue = number | string | null;

export interface ColorByLegendEntry {
  label: string;
  color: string;
}

export interface BucketColors {
  colors: Map<string, string>;
  legend: ColorByLegendEntry[];
}

/** Runs with no value. */
export const NO_VALUE_COLOR = "#9ca3af";
export const OTHER_LABEL = "other";
export const NO_VALUE_LABEL = "no value";

const INSET = 0.1;

/** Colour `i` of `n` evenly spaced along the palette's inset range. */
function paletteColor(palette: ColorByPalette, i: number, n: number): string {
  const t = n <= 1 ? 0.5 : i / (n - 1);
  return sampleColormap(palette, INSET + t * (1 - 2 * INSET));
}

/** A bucket bound, short: 3 significant digits. */
export function formatBound(v: number): string {
  if (v === 0) return "0";
  const r = Number(v.toPrecision(3));
  const a = Math.abs(r);
  return a >= 1e5 || a < 1e-3 ? r.toExponential(1).replace("e+", "e") : String(r);
}

export function bucketColors(
  values: ReadonlyMap<string, ColorByValue>,
  opts: { buckets: number; palette: ColorByPalette },
): BucketColors {
  const n = Math.max(1, Math.round(opts.buckets));
  const colors = new Map<string, string>();
  const legend: ColorByLegendEntry[] = [];
  const present = [...values.values()].filter((v): v is number | string => v !== null);
  const anyMissing = present.length < values.size;
  const categorical = present.some((v) => typeof v === "string");

  if (present.length > 0 && !categorical) {
    const nums = present as number[];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (min === max) {
      const color = paletteColor(opts.palette, 0, 1);
      legend.push({ label: formatBound(min), color });
      for (const [id, v] of values) if (v !== null) colors.set(id, color);
    } else {
      const width = (max - min) / n;
      for (let i = 0; i < n; i++) {
        const lo = min + i * width;
        const hi = i === n - 1 ? max : min + (i + 1) * width;
        legend.push({ label: `${formatBound(lo)}–${formatBound(hi)}`, color: paletteColor(opts.palette, i, n) });
      }
      for (const [id, v] of values) {
        if (v === null) continue;
        const i = Math.min(n - 1, Math.floor(((v as number) - min) / width));
        colors.set(id, legend[i]!.color);
      }
    }
  } else if (present.length > 0) {
    const counts = new Map<string, number>();
    for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    const distinct = [...counts.keys()].sort(byName);
    const overflow = distinct.length > n;
    // Over the cap: the most common values keep a bucket, the rest are "other".
    const kept = overflow
      ? [...distinct].sort((a, b) => counts.get(b)! - counts.get(a)! || byName(a, b)).slice(0, n - 1).sort(byName)
      : distinct;
    const k = kept.length + (overflow ? 1 : 0);
    const colorOf = new Map<string, string>();
    kept.forEach((label, i) => {
      const color = paletteColor(opts.palette, i, k);
      colorOf.set(label, color);
      legend.push({ label, color });
    });
    const otherColor = overflow ? paletteColor(opts.palette, k - 1, k) : "";
    if (overflow) legend.push({ label: OTHER_LABEL, color: otherColor });
    for (const [id, v] of values) {
      if (v === null) continue;
      colors.set(id, colorOf.get(String(v)) ?? otherColor);
    }
  }

  if (anyMissing) {
    legend.push({ label: NO_VALUE_LABEL, color: NO_VALUE_COLOR });
    for (const [id, v] of values) if (v === null) colors.set(id, NO_VALUE_COLOR);
  }
  return { colors, legend };
}

/** An expression's raw value as a colour-by value: finite numbers, text, bools as text; else null. */
export function toColorByValue(v: unknown): ColorByValue {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v === "" ? null : v;
  if (typeof v === "boolean") return String(v);
  return null;
}
