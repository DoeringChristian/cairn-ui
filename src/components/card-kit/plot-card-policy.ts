export interface PlotCardPolicy {
  defaultHeight: number;
}

const LARGE_INTERACTIVE = new Set(["figure", "pointcloud", "mesh", "boxes3d", "volume"]);

/** Default height for chart and media cards, by kind (widths: lib/cards/card-width.ts). */
export function plotCardPolicy(kind: string): PlotCardPolicy {
  if (LARGE_INTERACTIVE.has(kind)) return { defaultHeight: 400 };
  if (kind === "scalar") return { defaultHeight: 300 };
  return { defaultHeight: 360 };
}
