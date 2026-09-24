import { useMemo } from "react";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { readChartTheme } from "./theme.ts";
import { formatNum } from "../lib/plot-utils/types.ts";
import { useBackgroundClick } from "./ScatterChart.tsx";

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
  selectedIds?: Set<string>;
  onClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  className?: string;
}

/** Horizontal bars, one per run, for a single metric. */
export default function BarChart({
  bars, valueLabel, logX, compareMode, runOrder, selectedIds, onClick, onBackgroundClick, className,
}: Props) {
  // Summing on a log axis is misleading: stacked falls back to grouped there.
  const mode: BarCompareMode = compareMode === "stacked" && logX ? "grouped" : compareMode;
  const composed = mode !== "grouped" && bars.length > 1;

  const data = useMemo<PlotlyData>(() => {
    const theme = readChartTheme(null);
    const outline = (b: BarDatum) => (selectedIds?.has(b.id) ? 2 : 0);
    if (!composed) {
      return [{
        type: "bar",
        orientation: "h",
        x: bars.map((b) => b.value),
        y: bars.map((b) => b.id),
        customdata: bars.map((b) => [b.id, b.label]),
        hovertemplate: "<b>%{customdata[1]}</b><br>%{x}<extra></extra>",
        marker: { color: bars.map((b) => b.color), line: { width: bars.map(outline), color: theme.fg } },
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
      marker: { color: b.color, line: { width: outline(b), color: theme.fg } },
    }));
  }, [bars, composed, mode, runOrder, valueLabel, selectedIds]);

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

  const bg = useBackgroundClick(onBackgroundClick);

  return (
    <div className={className} {...bg.wrapper}>
      <PlotlyChart
        data={data}
        layout={layout}
        onClick={(e) => {
          const cd = e.points[0]?.customdata as [string, string] | undefined;
          if (!cd) return;
          bg.pointClicked();
          onClick?.(cd[0]);
        }}
      />
    </div>
  );
}
