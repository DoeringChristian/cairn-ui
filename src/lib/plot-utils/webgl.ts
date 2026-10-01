// ---------------------------------------------------------------------------
// Draw-time SVG → WebGL conversion for user Plotly figures.
//
// `toWebGL` turns `scatter` traces into `scattergl` for drawing only: the
// stored figure is never touched (every trace that changes is a shallow
// copy). A trace is converted only when scattergl draws it the same way; a
// trace using something scattergl lacks (spline lines, stacking, fill
// patterns, marker gradients, …) or one tied to a neighbour by a
// `fill: "tonext*"` chain stays SVG, and the result says why.
//
// Pure module (no plotly.js import) so it runs under `node --test`.
// ---------------------------------------------------------------------------

export type WebGLMode = "auto" | "on" | "off";

/**
 * `auto` converts a figure once its scatter traces hold this many points
 * together — the same cut-off plotly.express's `render_mode="auto"` uses
 * (WebGL above 1000 rows). Counted per figure, not per trace, so every
 * convertible trace of a figure switches together and the drawing order of
 * its traces stays as authored (WebGL traces always draw under SVG ones).
 */
export const WEBGL_AUTO_THRESHOLD = 1000;

export type Trace = Record<string, unknown>;

export interface WebGLSkip {
  index: number;
  reason: string;
}

export interface WebGLResult {
  /** The traces to draw: `data` itself when nothing changed, else a new array. */
  data: Trace[];
  /** Indices of the traces turned into `scattergl`. */
  converted: number[];
  /** Scatter traces left as SVG, and why. */
  skipped: WebGLSkip[];
  /** Points in the figure's scatter traces (what `auto` compares). */
  points: number;
}

/**
 * Scatter attributes scattergl does not have (from Plotly 3.5's PlotSchema:
 * scatter's attribute paths minus scattergl's). A trace setting any of them
 * would draw differently, so it is left as SVG. `harmless` lists the values
 * that match scattergl's fixed behaviour and so do not block conversion.
 */
const UNSUPPORTED: Record<string, { harmless?: unknown[] }> = {
  stackgroup: {},
  orientation: {},
  groupnorm: {},
  stackgaps: {},
  offsetgroup: {},
  alignmentgroup: {},
  hoveron: { harmless: ["points"] },
  cliponaxis: { harmless: [true] },
  zorder: { harmless: [0] },
  "line.smoothing": {},
  "line.backoff": { harmless: [0, "auto"] },
  "line.simplify": { harmless: [true] },
  fillgradient: {},
  fillpattern: {},
  "marker.angleref": { harmless: ["up"] },
  "marker.standoff": { harmless: [0] },
  "marker.maxdisplayed": { harmless: [0] },
  "marker.line.dash": { harmless: ["solid"] },
  "marker.gradient": {},
  "textfont.textcase": { harmless: ["normal"] },
  "textfont.lineposition": { harmless: ["none"] },
  "textfont.shadow": { harmless: ["none"] },
};

const SUPPORTED_SHAPES = new Set(["linear", "hv", "vh", "hvh", "vhv"]);

function get(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const p of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** An empty container (e.g. `fillpattern: {}`) sets nothing. */
function isSet(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "object" && !Array.isArray(v)) return Object.values(v as object).some(isSet);
  return true;
}

const ITEM_SIZE: Record<string, number> = { i1: 1, u1: 1, i2: 2, u2: 2, i4: 4, u4: 4, f4: 4, i8: 8, u8: 8, f8: 8 };

/**
 * Length of a Plotly data array: a plain array, a typed array, or
 * plotly.py's base64 typed-array encoding (`{dtype, bdata, shape?}`).
 */
export function arrayLength(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (ArrayBuffer.isView(v)) return (v as unknown as { length?: number }).length ?? 0;
  if (v && typeof v === "object") {
    const { dtype, bdata, shape } = v as { dtype?: string; bdata?: unknown; shape?: unknown };
    if (typeof shape === "string" && shape.trim()) {
      const first = Number(shape.split(",")[0]);
      if (Number.isFinite(first)) return first;
    }
    if (typeof bdata === "string" && dtype && ITEM_SIZE[dtype]) {
      const pad = bdata.endsWith("==") ? 2 : bdata.endsWith("=") ? 1 : 0;
      return Math.floor(((bdata.length * 3) / 4 - pad) / ITEM_SIZE[dtype]);
    }
  }
  return 0;
}

/** A trace's point count: the longer of its x and y. */
export function tracePoints(t: Trace): number {
  return Math.max(arrayLength(t.x), arrayLength(t.y));
}

/** `type` absent means scatter (Plotly's default trace type). */
function isScatter(t: Trace): boolean {
  return (t.type ?? "scatter") === "scatter";
}

/** Why scattergl would draw this trace differently, or null when it would not. */
function blocker(t: Trace): string | null {
  const shape = get(t, "line.shape");
  if (typeof shape === "string" && !SUPPORTED_SHAPES.has(shape)) return `line.shape "${shape}"`;
  for (const [path, { harmless }] of Object.entries(UNSUPPORTED)) {
    const v = get(t, path);
    if (!isSet(v)) continue;
    if (harmless?.some((h) => h === v)) continue;
    return `${path} is not supported by scattergl`;
  }
  return null;
}

/** The subplot a cartesian trace draws in, as its axis pair. */
function subplotOf(t: Trace): string {
  return `${(t.xaxis as string | undefined) ?? "x"}/${(t.yaxis as string | undefined) ?? "y"}`;
}

/**
 * The traces to draw for `mode`.
 *
 * - `off`: the figure as authored.
 * - `on`: every scatter trace scattergl can draw becomes scattergl.
 * - `auto`: as `on`, but only when the figure's scatter traces hold at
 *   least `threshold` points together.
 *
 * Traces already using WebGL (or any other type) are kept as they are.
 */
export function toWebGL(data: Trace[], _layout: Record<string, unknown> | undefined, mode: WebGLMode, threshold = WEBGL_AUTO_THRESHOLD): WebGLResult {
  let points = 0;
  for (const t of data) if (isScatter(t)) points += tracePoints(t);
  const none: WebGLResult = { data, converted: [], skipped: [], points };
  if (mode === "off" || (mode === "auto" && points < threshold)) return none;

  const skipped = new Map<number, string>();
  data.forEach((t, i) => {
    if (!isScatter(t)) return;
    const why = blocker(t);
    if (why) skipped.set(i, why);
  });

  // `fill: "tonext*"` fills to the previous trace of the same subplot, and
  // only between traces of one kind: both ends must convert, or neither.
  // Walk each chain to a fixed point (a skip can propagate both ways).
  const pairs: Array<[number, number]> = [];
  const lastIn = new Map<string, number>();
  data.forEach((t, i) => {
    if (!isScatter(t)) return;
    const sub = subplotOf(t);
    const fill = t.fill;
    const prev = lastIn.get(sub);
    if (typeof fill === "string" && fill.startsWith("tonext") && prev !== undefined) pairs.push([prev, i]);
    lastIn.set(sub, i);
  });
  for (let changed = true; changed; ) {
    changed = false;
    for (const [a, b] of pairs) {
      if (skipped.has(a) === skipped.has(b)) continue;
      const [kept, other] = skipped.has(a) ? [b, a] : [a, b];
      skipped.set(kept, `fills to/from trace ${other}, which stays SVG`);
      changed = true;
    }
  }

  const converted: number[] = [];
  const out = data.map((t, i) => {
    if (!isScatter(t) || skipped.has(i)) return t;
    converted.push(i);
    return { ...t, type: "scattergl" };
  });
  return {
    data: converted.length ? out : data,
    converted,
    skipped: [...skipped].map(([index, reason]) => ({ index, reason })).sort((a, b) => a.index - b.index),
    points,
  };
}
