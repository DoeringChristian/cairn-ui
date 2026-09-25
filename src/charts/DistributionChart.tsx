import { useMemo } from "react";

import PlotlyChart, { type PlotlyData } from "./PlotlyChart.tsx";
import { withAlpha } from "./theme.ts";

/** One group's values (one per run). */
export interface DistributionGroup {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** Per value: the run's label, shown on hover. */
  names: string[];
}

export type DistributionKind = "box" | "violin" | "strip";

interface Props {
  groups: DistributionGroup[];
  kind: DistributionKind;
  valueLabel?: string;
  /** Log value axis. */
  log?: boolean;
  className?: string;
}

const CLEAR = "rgba(0,0,0,0)";

/** Box, violin or strip plots of per-run values, one per group, every run shown as a point. */
export default function DistributionChart({ groups, kind, valueLabel, log, className }: Props) {
  const data = useMemo<PlotlyData>(
    () =>
      groups.map((g) => {
        const common = {
          name: g.label,
          x: g.values.map(() => g.label),
          y: g.values,
          text: g.names,
          hovertemplate: `%{text}<br>${valueLabel ?? "value"}: %{y}<extra>${g.label}</extra>`,
          marker: { color: g.color, size: 6 },
          showlegend: false,
        };
        if (kind === "violin") {
          return {
            ...common,
            type: "violin",
            points: "all",
            jitter: 0.4,
            pointpos: 0,
            box: { visible: true },
            meanline: { visible: true },
            line: { color: g.color },
            fillcolor: withAlpha(g.color, 0.2),
          };
        }
        return {
          ...common,
          type: "box",
          boxpoints: "all",
          jitter: kind === "strip" ? 0.5 : 0.4,
          pointpos: 0,
          ...(kind === "strip"
            ? { fillcolor: CLEAR, line: { color: CLEAR }, hoveron: "points" }
            : { boxmean: true, line: { color: g.color }, fillcolor: withAlpha(g.color, 0.2) }),
        };
      }),
    [groups, kind, valueLabel],
  );

  const layout = useMemo(
    () => ({
      hovermode: "closest",
      [kind === "violin" ? "violinmode" : "boxmode"]: "overlay",
      xaxis: { type: "category" },
      yaxis: { title: { text: valueLabel ?? "" }, type: log ? "log" : "linear" },
    }),
    [kind, valueLabel, log],
  );

  return (
    <div className={className}>
      <PlotlyChart data={data} layout={layout} />
    </div>
  );
}
