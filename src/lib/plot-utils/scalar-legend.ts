/**
 * The scalar chart's legend and line labels (pure): legend font size,
 * per-series label templates with hover-only `[[ … ]]` sections (wandb's
 * `[[ ${x}: ${y} ]] name`), and when a line draws point markers.
 */

export type LegendFontSize = "small" | "medium" | "large" | "auto";

const FONT_PX = { small: 10, medium: 12, large: 14 } as const;

/** Below this chart width, `auto` is small; at or above it, medium. */
export const AUTO_FONT_BREAK_PX = 480;

/** The legend's font size in px; `auto` follows the chart's width. */
export function legendFontPx(size: LegendFontSize, chartWidth: number): number {
  if (size === "auto") return chartWidth > 0 && chartWidth >= AUTO_FONT_BREAK_PX ? FONT_PX.medium : FONT_PX.small;
  return FONT_PX[size];
}

/**
 * One piece of a series label: plain text (a `${…}` run template, rendered
 * per run) or a hover section, the inside of `[[ … ]]`, shown only while the
 * cursor is on the chart with `${x}` / `${y}` filled in. `start` is the
 * offset of `src` in the label source.
 */
export interface LabelPart {
  hover: boolean;
  src: string;
  start: number;
}

/** Split a label at `[[ … ]]`; an unclosed `[[` is plain text. */
export function parseSeriesLabel(src: string): LabelPart[] {
  const parts: LabelPart[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("[[", i);
    const close = open < 0 ? -1 : src.indexOf("]]", open + 2);
    if (open < 0 || close < 0) {
      parts.push({ hover: false, src: src.slice(i), start: i });
      break;
    }
    if (open > i) parts.push({ hover: false, src: src.slice(i, open), start: i });
    parts.push({ hover: true, src: src.slice(open + 2, close), start: open + 2 });
    i = close + 2;
  }
  return parts;
}

const HOVER_VAR = /\$\{\s*(x|y)\s*\}/g;

/**
 * A label's text: plain parts through `text` (the run template; default as
 * written), hover parts only with `hover` (their `${x}` / `${y}` replaced),
 * whitespace collapsed.
 */
export function renderSeriesLabel(
  parts: readonly LabelPart[],
  opts: { text?: (src: string) => string; hover?: { x: string; y: string } | null } = {},
): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p.hover) out.push(opts.text ? opts.text(p.src) : p.src);
    else if (opts.hover) out.push(p.src.replace(HOVER_VAR, (_m, v: "x" | "y") => opts.hover![v]));
  }
  return out.join("").replace(/\s+/g, " ").trim();
}

/**
 * Whether a line draws point markers: a line of one or two points draws
 * little or nothing as a line (a single point is invisible), so its points
 * are marked. `col` is the line's values on the chart's shared x grid.
 */
export function showPointMarkers(col: ReadonlyArray<number | null | undefined>): boolean {
  let n = 0;
  for (const v of col) {
    if (v != null && Number.isFinite(v) && ++n > 2) return false;
  }
  return n > 0;
}
