/**
 * The `preset` artifact (cairn.ConfusionMatrix / PRCurve / ROCCurve): its JSON
 * shape and the Plotly traces PresetCard draws from it. Pure, no plotly import.
 */

import { seriesColor } from "./types.ts";

export interface PresetCurve {
  label: string;
  x: Array<number | null>;
  y: Array<number | null>;
  /** AUC (ROC) or average precision (PR); null when the class has no positives. */
  auc: number | null;
}

export type CurveKind = "pr_curve" | "roc_curve";

export type PresetBlob =
  | { kind: "confusion_matrix"; data: { labels: string[]; counts: number[][] } }
  | { kind: CurveKind; data: { curves: PresetCurve[] } };

export type Normalize = "none" | "true" | "pred";

type Trace = Record<string, unknown>;

/** Line dash per class when colors mean runs. */
export const CLASS_DASHES = ["solid", "dash", "dot", "dashdot", "longdash", "longdashdot"] as const;

export const PRESET_KIND_LABELS: Record<PresetBlob["kind"], string> = {
  confusion_matrix: "confusion matrix",
  pr_curve: "PR curve",
  roc_curve: "ROC curve",
};

/** Rows (`true`) or columns (`pred`) scaled to sum to 1; an empty row/column is null. */
export function normalizeCounts(counts: number[][], mode: Normalize): Array<Array<number | null>> {
  if (mode === "none") return counts;
  if (mode === "true") {
    return counts.map((row) => {
      const sum = row.reduce((a, b) => a + b, 0);
      return row.map((v) => (sum > 0 ? v / sum : null));
    });
  }
  const colSums = counts[0]?.map((_, j) => counts.reduce((a, row) => a + (row[j] ?? 0), 0)) ?? [];
  return counts.map((row) => row.map((v, j) => (colSums[j]! > 0 ? v / colSums[j]! : null)));
}

/** An annotated heatmap: true label down the rows, predicted across the columns. */
export function confusionTrace(
  data: { labels: string[]; counts: number[][] },
  normalize: Normalize,
): Trace {
  const z = normalizeCounts(data.counts, normalize);
  const text = z.map((row, i) => row.map((v, j) =>
    normalize === "none" ? String(data.counts[i]![j]) : v === null ? "n/a" : v.toFixed(2)));
  let zmax = 0;
  for (const row of z) for (const v of row) if (v !== null && v > zmax) zmax = v;
  return {
    type: "heatmap",
    x: data.labels,
    y: data.labels,
    z,
    text,
    texttemplate: "%{text}",
    colorscale: "Blues",
    // Plotly's named "Blues" runs dark → light; high counts should be dark.
    reversescale: true,
    zmin: 0,
    zmax: zmax > 0 ? zmax : 1,
    showscale: false,
    hovertemplate: "true %{y}<br>pred %{x}<br>%{text}<extra></extra>",
  };
}

export const CONFUSION_LAYOUT = {
  xaxis: { title: { text: "predicted" }, type: "category", side: "bottom" },
  yaxis: { title: { text: "true" }, type: "category", autorange: "reversed" },
};

export function formatAuc(kind: CurveKind, auc: number | null): string {
  return `${kind === "pr_curve" ? "AP" : "AUC"}=${auc === null ? "n/a" : auc.toFixed(3)}`;
}

/**
 * Line traces for one or more runs' curves. One run: a color per class.
 * Several runs: a color per run (`color`, else by index) and a dash per class,
 * legend "run · class".
 */
export function curveTraces(
  kind: CurveKind,
  series: Array<{ label: string; curves: PresetCurve[]; /** The run's colour when several runs overlay. */ color?: string }>,
): Trace[] {
  const multi = series.length > 1;
  const traces: Trace[] = [];
  series.forEach((s, si) => {
    s.curves.forEach((c, ci) => {
      const name = `${multi ? `${s.label} · ` : ""}${c.label} (${formatAuc(kind, c.auc)})`;
      traces.push({
        type: "scatter",
        mode: "lines",
        x: c.x,
        y: c.y,
        name,
        line: {
          color: multi ? (s.color ?? seriesColor(si)) : seriesColor(ci),
          dash: multi ? CLASS_DASHES[ci % CLASS_DASHES.length] : "solid",
          width: 1.5,
        },
        hovertemplate: `${kind === "pr_curve" ? "recall" : "FPR"} %{x:.3f}<br>${kind === "pr_curve" ? "precision" : "TPR"} %{y:.3f}<extra>%{fullData.name}</extra>`,
      });
    });
  });
  if (kind === "roc_curve") {
    traces.push({
      type: "scatter",
      mode: "lines",
      x: [0, 1],
      y: [0, 1],
      name: "chance",
      line: { dash: "dash", color: "gray", width: 1 },
      hoverinfo: "skip",
      showlegend: false,
    });
  }
  return traces;
}

export function curveLayout(kind: CurveKind): Record<string, unknown> {
  const pr = kind === "pr_curve";
  return {
    xaxis: { title: { text: pr ? "recall" : "false positive rate" }, range: [0, 1] },
    yaxis: { title: { text: pr ? "precision" : "true positive rate" }, range: [0, pr ? 1.05 : 1.02] },
    showlegend: true,
  };
}
