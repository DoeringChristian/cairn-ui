/** The built-in functions. MIRRORED by cairn `cairn/expr.py`. */

/** `min|max|mean|first|last(series) → scalar` (`min|max(a, b)` is pointwise). */
export const REDUCERS = ["min", "max", "mean", "first", "last"] as const;
export type Reducer = (typeof REDUCERS)[number];

export const FUNCTION_NAMES: readonly string[] = [
  ...REDUCERS,
  "cummin",
  "cummax",
  "diff",
  "ema",
  "log",
  "exp",
  "abs",
  "clip",
  "exact",
  "resample",
];

export function isReducer(fn: string): fn is Reducer {
  return (REDUCERS as readonly string[]).includes(fn);
}
