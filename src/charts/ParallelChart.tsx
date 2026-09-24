import { useMemo } from "react";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { formatNum } from "../lib/plot-utils/types.ts";

export interface ParallelColumn {
  key: string;
  source: "param" | "metric";
  log?: boolean;
  invert?: boolean;
}

export interface ParallelRow {
  id: string;
  /** Numeric value per column, null when missing or not a number. */
  values: Array<number | null>;
  /** The value as logged, per column. */
  raw: Array<string | null>;
}

interface Props {
  columns: ParallelColumn[];
  rows: ParallelRow[];
  className?: string;
}

interface Dimension {
  label: string;
  values: number[];
  range?: [number, number];
  tickvals?: number[];
  ticktext?: string[];
}

/** Ticks for a log10 axis spanning [lo, hi] (in log space), labelled in original units. */
function logTicks(lo: number, hi: number): { tickvals: number[]; ticktext: string[] } {
  const tickvals: number[] = [];
  const mantissas = Math.floor(hi) - Math.ceil(lo) >= 1 ? [1] : [1, 2, 5];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (const m of mantissas) {
      const t = e + Math.log10(m);
      if (t >= lo - 1e-9 && t <= hi + 1e-9) tickvals.push(t);
    }
  }
  if (tickvals.length < 2) tickvals.splice(0, tickvals.length, lo, hi);
  return { tickvals, ticktext: tickvals.map((t) => formatNum(10 ** t)) };
}

function dimension(col: ParallelColumn, ci: number, rows: ParallelRow[]): Dimension {
  // A column with any value that is not a number is categorical: one tick per distinct string.
  const categorical = rows.some((r) => r.values[ci] == null && r.raw[ci] != null);
  let dim: Dimension;
  if (categorical) {
    const cats = Array.from(new Set(rows.map((r) => r.raw[ci]).filter((v): v is string => v != null))).sort();
    const index = new Map(cats.map((c, i) => [c, i]));
    dim = {
      label: col.key,
      values: rows.map((r) => (r.raw[ci] != null ? index.get(r.raw[ci]!)! : NaN)),
      range: cats.length > 1 ? [0, cats.length - 1] : [-0.5, 0.5],
      tickvals: cats.map((_, i) => i),
      ticktext: cats,
    };
  } else {
    const values = rows.map((r) => {
      const v = r.values[ci];
      if (v == null) return NaN;
      if (col.log) return v > 0 ? Math.log10(v) : NaN;
      return v;
    });
    const finite = values.filter(Number.isFinite);
    let lo = finite.length ? Math.min(...finite) : 0;
    let hi = finite.length ? Math.max(...finite) : 1;
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    dim = { label: col.log ? `${col.key} (log)` : col.key, values, range: [lo, hi], ...(col.log ? logTicks(lo, hi) : {}) };
  }
  if (col.invert && dim.range) dim.range = [dim.range[1], dim.range[0]];
  return dim;
}

/** One polyline per run across the columns; colored by the rightmost column. */
export default function ParallelChart({ columns, rows, className }: Props) {
  const data = useMemo<PlotlyData>(() => {
    const dimensions = columns.map((col, ci) => dimension(col, ci, rows));
    const colorDim = dimensions[dimensions.length - 1];
    return [{
      type: "parcoords",
      dimensions,
      line: colorDim
        ? {
            color: colorDim.values,
            colorscale: "Viridis",
            showscale: true,
            colorbar: {
              title: { text: colorDim.label, side: "right" },
              thickness: 10,
              outlinewidth: 0,
              ...(colorDim.tickvals ? { tickvals: colorDim.tickvals, ticktext: colorDim.ticktext } : {}),
            },
          }
        : {},
      labelangle: 0,
      labelside: "top",
    }];
  }, [columns, rows]);

  const layout = useMemo(() => ({ margin: { l: 48, r: 48, t: 36, b: 24 } }), []);

  return (
    <div className={className}>
      <PlotlyChart data={data} layout={layout} />
    </div>
  );
}
