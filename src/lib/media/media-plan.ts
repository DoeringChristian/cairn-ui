/**
 * What a media card shows: which runs, slider values and list items become
 * tiles, per panel mode (see panel-layout.ts), the way wandb's media panel
 * does it.
 *
 * Three variables pick one medium: the **run**, the **step** (a slider value;
 * per run it resolves to a step, see slider-key.ts) and the **index** into a
 * logged list (a gallery point, see gallery.ts). A tile fixes the run and the
 * value and names the list items it shows (`items`), or `null` for a plain
 * (non-list) point.
 *
 * - **Index** (lists only): All, One `i`, Range `a`–`b` or First `N` items of
 *   each list. Applied in every mode.
 * - **Gallery**: tiles in `columns` columns. Column content says what a tile
 *   is: `index` one tile per selected list item at the slider's value;
 *   `step` tiles over slider values (sampled like the grid's columns) for the
 *   first selected item; `run` one tile per run (the selected items together).
 * - **Grid**: two distinct axes out of step · index · run. The step axis is
 *   the slider values in the steps range, sampled evenly; the index axis the
 *   selected items. The variable on neither axis: step → the slider's value,
 *   index → the Index selection in each cell, run → folded into the rows
 *   (each run repeats the Y axis). At most `rows` rows.
 * - **Compare**: slots; Run, Step and Index are each linked (card-wide: the
 *   first run, the slider, the Index selection) or individual (the slot's own).
 * - **Media limit**: at most N tiles (grid: whole rows while they fit).
 *
 * Pure: tested in `media-plan.test.ts`.
 */

import { AUTO_GRID_COLUMNS, sampleValues, type Columns, type CompareSlot } from "./panel-layout.ts";

// ---------------------------------------------------------------------------
// Index

export type IndexMode = "all" | "one" | "range" | "first";
export const INDEX_MODES: readonly IndexMode[] = ["all", "one", "range", "first"];

export interface IndexSelection {
  indexMode: IndexMode;
  /** One: the item (0-based). */
  indexOne: number;
  /** Range: first and last item, inclusive (0-based). */
  indexFrom: number;
  indexTo: number;
  /** First N: how many items. */
  indexFirst: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * The items of a `count`-item list the selection shows, ascending. One past
 * the end shows the last item; a range is clamped to the list (its ends in
 * either order); no items for an empty list.
 */
export function selectIndices(sel: IndexSelection, count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const all = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  switch (sel.indexMode) {
    case "one":
      return [clampInt(sel.indexOne, 0, n - 1)];
    case "range": {
      const a = clampInt(Math.min(sel.indexFrom, sel.indexTo), 0, n - 1);
      const b = clampInt(Math.max(sel.indexFrom, sel.indexTo), 0, n - 1);
      return all(a, b);
    }
    case "first":
      return all(0, clampInt(sel.indexFirst, 1, n) - 1);
    default:
      return all(0, n - 1);
  }
}

/** The first selected item: what a tile showing ONE item of the selection shows (0 for an empty list). */
export function primaryIndex(sel: IndexSelection, count: number): number {
  return selectIndices(sel, count)[0] ?? 0;
}

/** The One index after the header stepper's ‹ (−1) or › (+1): clamped to the list. */
export function stepIndex(current: number, delta: number, count: number): number {
  return clampInt(current + delta, 0, Math.max(0, count - 1));
}

// ---------------------------------------------------------------------------
// Tiles

export type MediaAxis = "step" | "index" | "run";
export const MEDIA_AXES: readonly MediaAxis[] = ["step", "index", "run"];
export type GalleryContent = MediaAxis;

/** One tile: a run (its pane index) at a slider value, and the list items it shows. */
export interface TileRef {
  /** Stable id within the card (per mode and position). */
  id: string;
  run: number;
  value: number;
  /** Items of the run's list at `value` (ascending); `null` for a plain point. */
  items: number[] | null;
}

/** What the planners need to know about the card's data. */
export interface PlanData {
  /** Runs (panes) shown, in order. */
  runs: number;
  /** The slider's positions, ascending. */
  values: readonly number[];
  /** The slider's value. */
  current: number;
  /** The card holds lists (any shown point is a gallery). */
  lists: boolean;
  /** Items of run `run`'s point at slider value `value` (0: none, 1 for a plain point). */
  countAt: (run: number, value: number) => number;
}

/** Slider values within `[from, to]` (either end open when null). */
export function valuesInRange(values: readonly number[], from: number | null | undefined, to: number | null | undefined): number[] {
  const lo = from ?? -Infinity;
  const hi = to ?? Infinity;
  return values.filter((v) => v >= Math.min(lo, hi) && v <= Math.max(lo, hi));
}

/** How many columns `auto` means for a step axis / step tiles. */
export const stepColumns = (columns: Columns): number => (columns === "auto" ? AUTO_GRID_COLUMNS : Math.max(1, Math.round(columns)));

/** The items a whole-selection tile shows: the selection, or null without lists. */
function selectedItems(data: PlanData, sel: IndexSelection, run: number, value: number): number[] | null {
  return data.lists ? selectIndices(sel, data.countAt(run, value)) : null;
}

/** One item, or null without lists. */
function oneItem(data: PlanData, i: number): number[] | null {
  return data.lists ? [i] : null;
}

/** The largest list among the runs at the given values (0 without lists). */
export function maxCount(data: PlanData, values: readonly number[]): number {
  if (!data.lists) return 0;
  let n = 0;
  for (let r = 0; r < data.runs; r++) for (const v of values) n = Math.max(n, data.countAt(r, v));
  return n;
}

/**
 * Gallery mode. `panes`: one tile per run (the card's per-run pane layout);
 * `tiles`: a flat grid of `columns` columns (`columns` resolved for auto).
 */
export interface GalleryPlan {
  layout: "panes" | "tiles";
  content: GalleryContent;
  tiles: TileRef[];
  /** Grid columns for `tiles` (auto resolved); unused for `panes`. */
  columns: number;
}

export function planGallery(data: PlanData, sel: IndexSelection, content: GalleryContent, columns: Columns): GalleryPlan {
  const runs = Array.from({ length: data.runs }, (_, r) => r);
  // Without lists an index tile is the run's one point: the per-run panes.
  const effective: GalleryContent = content === "index" && !data.lists ? "run" : content;
  if (effective === "run") {
    const tiles = runs.map((r) => ({ id: `gallery:${r}`, run: r, value: data.current, items: selectedItems(data, sel, r, data.current) }));
    return { layout: "panes", content: "run", tiles, columns: 0 };
  }
  if (effective === "step") {
    const vals = sampleValues(data.values, stepColumns(columns));
    const tiles = runs.flatMap((r) =>
      vals.map((v, k) => ({
        id: `gallery:${r}:s${k}`,
        run: r,
        value: v,
        items: oneItem(data, primaryIndex(sel, data.countAt(r, v))),
      })));
    return { layout: "tiles", content: "step", tiles, columns: columns === "auto" ? Math.max(1, vals.length) : stepColumns(columns) };
  }
  const per = runs.map((r) => selectIndices(sel, data.countAt(r, data.current)));
  const tiles = runs.flatMap((r) =>
    per[r]!.map((i) => ({ id: `gallery:${r}:i${i}`, run: r, value: data.current, items: [i] })));
  const widest = Math.max(1, ...per.map((p) => p.length));
  return {
    layout: "tiles",
    content: "index",
    tiles,
    columns: columns === "auto" ? Math.min(widest, Math.ceil(Math.sqrt(widest))) : Math.max(1, Math.round(columns)),
  };
}

/** One position along a grid axis. */
export type AxisCell =
  | { axis: "step"; value: number }
  | { axis: "index"; index: number }
  | { axis: "run"; run: number };

/** A grid row: its Y position, and its run when the run is on neither axis. */
export interface GridRow {
  y: AxisCell;
  run?: number;
}

export interface GridPlan {
  x: MediaAxis;
  y: MediaAxis;
  columns: AxisCell[];
  rows: GridRow[];
  /** `cells[row][column]`. */
  cells: TileRef[][];
  /** Rows the rows cap or the media limit left out. */
  hiddenRows: number;
}

export interface GridOptions {
  x: MediaAxis;
  y: MediaAxis;
  /** Step axis range (slider values, inclusive; null: open). */
  stepFrom?: number | null;
  stepTo?: number | null;
  /** Grid columns: how many slider values a step X axis samples. */
  columns: Columns;
  /** At most this many rows (a step Y axis samples this many values). */
  rows: number;
  /** Media limit: at most this many tiles (null: all). */
  limit?: number | null;
}

/**
 * The two axes made valid: distinct, and without lists no index axis
 * (Step × Run then, as a grid without lists has nothing else to show).
 */
export function normalizeAxes(x: MediaAxis, y: MediaAxis, lists: boolean): { x: MediaAxis; y: MediaAxis } {
  const ok = (a: MediaAxis) => lists || a !== "index";
  const nx = ok(x) ? x : "step";
  let ny = ok(y) ? y : "run";
  if (nx === ny) ny = MEDIA_AXES.find((a) => a !== nx && ok(a))!;
  return { x: nx, y: ny };
}

export function planGrid(data: PlanData, sel: IndexSelection, opts: GridOptions): GridPlan {
  const { x, y } = normalizeAxes(opts.x, opts.y, data.lists);
  const ranged = valuesInRange(data.values, opts.stepFrom, opts.stepTo);
  const rowCap = Math.max(1, Math.round(opts.rows));
  const cellsOf = (axis: MediaAxis, cap: number): AxisCell[] => {
    if (axis === "step") return sampleValues(ranged, cap).map((value) => ({ axis, value }));
    if (axis === "run") return Array.from({ length: data.runs }, (_, run) => ({ axis, run }));
    const n = maxCount(data, ranged.length ? ranged : [data.current]);
    return selectIndices(sel, n).map((index) => ({ axis, index }));
  };
  const columns = cellsOf(x, stepColumns(opts.columns));
  const yCells = cellsOf(y, rowCap);
  const folded = x !== "run" && y !== "run";
  let rows: GridRow[] = folded
    ? Array.from({ length: data.runs }, (_, run) => yCells.map((c) => ({ y: c, run }))).flat()
    : yCells.map((c) => ({ y: c }));
  const total = rows.length;
  rows = rows.slice(0, rowCap);
  if (opts.limit != null && opts.limit > 0 && columns.length > 0) {
    rows = rows.slice(0, Math.max(1, Math.floor(opts.limit / columns.length)));
  }
  const keptColumns = opts.limit != null && opts.limit > 0 ? columns.slice(0, Math.max(1, opts.limit)) : columns;
  const cells = rows.map((row, ri) =>
    keptColumns.map((col, ci) => {
      let run = row.run ?? 0;
      let value = data.current;
      let item: number | undefined; // undefined: the Index selection
      for (const c of [col, row.y]) {
        if (c.axis === "run") run = c.run;
        else if (c.axis === "step") value = c.value;
        else item = c.index;
      }
      const items = !data.lists ? null : item === undefined ? selectIndices(sel, data.countAt(run, value)) : [item];
      return { id: `grid:${ri}:${ci}`, run, value, items };
    }));
  return { x, y, columns: keptColumns, rows, cells, hiddenRows: total - rows.length };
}

// ---------------------------------------------------------------------------
// Compare

export type LinkMode = "linked" | "individual";

export interface CompareLinks {
  compareRun: LinkMode;
  compareStep: LinkMode;
  compareIndex: LinkMode;
}

/**
 * The tile a compare slot shows. Linked variables take the card's: the first
 * run, the slider's value, the Index selection; individual ones the slot's
 * own (its run, its value — the slider's until it has one — and its item).
 * `pane` is the slot's run as an index into `paneKeys` (-1: none).
 */
export function resolveSlot(
  slot: CompareSlot,
  i: number,
  links: CompareLinks,
  paneKeys: readonly string[],
  data: PlanData,
  sel: IndexSelection,
): TileRef {
  const run = links.compareRun === "linked" ? (paneKeys.length ? 0 : -1) : paneKeys.indexOf(slot.pane);
  const value = links.compareStep === "linked" || slot.value == null ? data.current : slot.value;
  const items = !data.lists || run < 0
    ? null
    : links.compareIndex === "linked"
      ? selectIndices(sel, data.countAt(run, value))
      : [Math.max(0, Math.round(slot.index ?? 0))];
  return { id: `compare:${i}`, run, value, items };
}

/**
 * Slots after one variable's link mode changes: going individual freezes each
 * slot where it was (the slider's value; the first selected item); linking
 * drops the slots' own value or item. Run keeps each slot's pane either way.
 */
export function relinkSlots(
  slots: readonly CompareSlot[],
  variable: "step" | "index",
  mode: LinkMode,
  frozen: { value: number; index: number },
): CompareSlot[] {
  return slots.map((s) => {
    const next: CompareSlot = { ...s };
    if (variable === "step") {
      if (mode === "linked") delete next.value;
      else next.value = s.value ?? frozen.value;
    } else {
      if (mode === "linked") delete next.index;
      else next.index = s.index ?? frozen.index;
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Media limit

/** The first `limit` tiles (all when `limit` is null or not positive). */
export function limitTiles<T>(tiles: readonly T[], limit: number | null | undefined): T[] {
  return limit != null && limit > 0 ? tiles.slice(0, Math.round(limit)) : [...tiles];
}
