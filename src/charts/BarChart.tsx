import { useMemo } from "react";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { formatNum } from "../lib/plot-utils/types.ts";

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  color: string;
}

/**
 * How several runs' bars for the one metric compose:
 * - "grouped": one row per run, in the given (sorted) order.
 * - "stacked": one summed row, segments in `runOrder` (not the sort order).
 * - "overlay": one row of translucent bars, drawn in the given order (last on top).
 */
export type BarCompareMode = "grouped" | "stacked" | "overlay";

interface Props {
  bars: BarDatum[];
  valueLabel?: string;
  logX?: boolean;
  compareMode: BarCompareMode;
  runOrder: string[];
  className?: string;
}

/** Horizontal bars, one per run, for a single metric. */
export default function BarChart({
  bars, valueLabel, logX, compareMode, runOrder, className,
}: Props) {
  // Summing on a log axis is misleading: stacked falls back to grouped there.
  const mode: BarCompareMode = compareMode === "stacked" && logX ? "grouped" : compareMode;
  const composed = mode !== "grouped" && bars.length > 1;

  const data = useMemo<PlotlyData>(() => {
    if (!composed) {
      return [{
        type: "bar",
        orientation: "h",
        x: bars.map((b) => b.value),
        y: bars.map((b) => b.id),
        customdata: bars.map((b) => [b.id, b.label]),
        hovertemplate: "<b>%{customdata[1]}</b><br>%{x}<extra></extra>",
        marker: { color: bars.map((b) => b.color) },
      }];
    }
    const category = valueLabel ?? "value";
    const byId = new Map(bars.map((b) => [b.id, b]));
    const ordered = mode === "stacked"
      ? runOrder.map((id) => byId.get(id)).filter((b): b is BarDatum => b != null)
      : bars;
    const total = bars.reduce((sum, b) => sum + b.value, 0);
    return ordered.map((b) => ({
      type: "bar",
      orientation: "h",
      name: b.label,
      x: [b.value],
      y: [category],
      customdata: [[b.id, b.label, total !== 0 ? formatNum((100 * b.value) / total) : "–"]],
      hovertemplate: mode === "stacked"
        ? "<b>%{customdata[1]}</b><br>%{x} (%{customdata[2]}% of total)<extra></extra>"
        : "<b>%{customdata[1]}</b><br>%{x}<extra></extra>",
      opacity: mode === "overlay" ? 0.5 : 1,
      showlegend: false,
      marker: { color: b.color },
    }));
  }, [bars, composed, mode, runOrder, valueLabel]);

  const layout = useMemo(() => {
    const labels = new Map(bars.map((b) => [b.id, b.label]));
    return {
      barmode: mode === "stacked" ? "stack" : mode === "overlay" ? "overlay" : "group",
      hovermode: "closest",
      xaxis: { title: { text: valueLabel ?? "" }, type: logX ? "log" : "linear" },
      yaxis: composed
        ? { type: "category", showticklabels: false }
        : {
            type: "category",
            autorange: "reversed",
            tickvals: bars.map((b) => b.id),
            ticktext: bars.map((b) => labels.get(b.id)),
          },
    };
  }, [bars, composed, mode, valueLabel, logX]);

  return (
    <div className={className}>
      <PlotlyChart data={data} layout={layout} />
    </div>
  );
}
