/**
 * Colours the runs of a scope by the workspace's `prefs.colorBy`
 * (lib/run-color-by.ts): evaluates the expression per run with
 * `useScalarExprs` and buckets the values over `runIds`. Mounted where
 * `ChartSyncProvider` is (the run page's grid, a comparison). Reports never
 * mount it: their cards use built-in defaults only.
 */

import { useMemo, type ReactNode } from "react";
import { bucketColors, toColorByValue, type ColorByValue } from "../lib/run-color-by";
import { RunColorByContext, type RunColorByValue } from "../lib/run-color-by-context";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import type { ColorBy } from "../lib/workspace/doc";

const NO_RUNS: string[] = [];

export default function RunColorByProvider({
  colorBy,
  runIds,
  children,
}: {
  colorBy: ColorBy | null;
  /** The runs in view: bucket bounds span their values. */
  runIds: readonly string[];
  children: ReactNode;
}) {
  const runKey = runIds.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => (colorBy ? [...runIds] : NO_RUNS), [runKey, colorBy != null]);
  const srcs = useMemo(() => (colorBy ? [colorBy.expr] : []), [colorBy?.expr]);
  const exprs = useScalarExprs(ids, srcs);

  const value = useMemo((): RunColorByValue => {
    if (!colorBy) return { runIds, colorBy: null, colors: new Map(), legend: [], error: null, loading: false };
    const raw = exprs.values[0];
    const values = new Map<string, ColorByValue>();
    // Every run's value, or none until they have all loaded (no half-bucketed flash).
    if (raw && !exprs.loading) for (const id of ids) values.set(id, toColorByValue(raw.get(id)));
    const { colors, legend } = bucketColors(values, colorBy);
    return { runIds, colorBy, colors, legend, error: exprs.errors[0] ?? null, loading: exprs.loading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy, exprs, ids, runKey]);

  return <RunColorByContext.Provider value={value}>{children}</RunColorByContext.Provider>;
}
