/**
 * How a media card lays out its panes.
 *
 * - `gallery`: one pane per series (run), all at the slider's value, in a
 *   wrapping grid of `columns` columns.
 * - `grid`: runs as rows × slider values as columns, so one glance shows how
 *   every run evolves.
 * - `compare`: 2–4 slots, each choosing its own series (run) and, unless the
 *   slots are linked to the card's slider, its own value.
 *
 * Pure: tested in `panel-layout.test.ts`.
 */

export type PanelMode = "gallery" | "grid" | "compare";
export const PANEL_MODES: readonly PanelMode[] = ["gallery", "grid", "compare"];

/** Gallery columns: `auto` (up to two, one on phones) or a fixed count. */
export type Columns = "auto" | number;

/** Grid columns shown when `columns` is `auto`. */
export const AUTO_GRID_COLUMNS = 5;

export const MIN_SLOTS = 2;
export const MAX_SLOTS = 4;

/** Columns of a pane grid holding `paneCount` panes. */
export function galleryColumns(columns: Columns, paneCount: number, compact: boolean): number {
  if (compact || paneCount <= 1) return 1;
  const want = columns === "auto" ? 2 : Math.max(1, Math.round(columns));
  return Math.min(paneCount, want);
}

/**
 * The items whose run is among the first `maxRuns` distinct runs (in item
 * order). `maxRuns` 0 (or less) keeps every item.
 */
export function limitRuns<T>(items: readonly T[], runOf: (item: T) => string, maxRuns: number): T[] {
  if (!(maxRuns > 0)) return [...items];
  const runs = new Set<string>();
  return items.filter((item) => {
    const run = runOf(item);
    if (runs.has(run)) return true;
    if (runs.size >= maxRuns) return false;
    runs.add(run);
    return true;
  });
}

/**
 * Up to `count` values spread evenly over the ascending `values`, always
 * including the first and the last. Fewer values than `count`: all of them.
 */
export function sampleValues(values: readonly number[], count: number): number[] {
  const n = values.length;
  const k = Math.max(1, Math.floor(count));
  if (n <= k) return [...values];
  if (k === 1) return [values[n - 1]!];
  const picked = new Set<number>();
  for (let i = 0; i < k; i++) picked.add(Math.round((i * (n - 1)) / (k - 1)));
  return [...picked].sort((a, b) => a - b).map((i) => values[i]!);
}

/** The slider values a grid shows as columns. */
export function gridValues(values: readonly number[], columns: Columns): number[] {
  return sampleValues(values, columns === "auto" ? AUTO_GRID_COLUMNS : columns);
}

/** One compare slot: which pane (series key) it shows, and its own value when unlinked. */
export interface CompareSlot {
  pane: string;
  value?: number;
}

/**
 * `slots` made valid for the card's current panes: `count` slots (clamped to
 * 2–4), slots naming a pane that no longer exists re-pointed, and missing
 * slots filled with panes not shown yet (cycling when there are fewer panes
 * than slots). No panes: no slots.
 */
export function normalizeSlots(
  slots: readonly CompareSlot[] | undefined,
  paneKeys: readonly string[],
  count?: number,
): CompareSlot[] {
  if (paneKeys.length === 0) return [];
  const want = clampSlots(count ?? (slots?.length || MIN_SLOTS));
  const known = new Set(paneKeys);
  const out: CompareSlot[] = [];
  const kept = (slots ?? []).slice(0, want);
  // Panes the valid slots already show are taken before any slot is repaired.
  const used = new Set(kept.map((s) => s.pane).filter((p) => known.has(p)));
  const nextFree = () => {
    const free = paneKeys.find((k) => !used.has(k));
    return free ?? paneKeys[out.length % paneKeys.length]!;
  };
  for (const s of kept) {
    const pane = known.has(s.pane) ? s.pane : nextFree();
    used.add(pane);
    out.push(s.value != null ? { pane, value: s.value } : { pane });
  }
  while (out.length < want) {
    const pane = nextFree();
    used.add(pane);
    out.push({ pane });
  }
  return out;
}

export function clampSlots(n: number): number {
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, Math.round(n)));
}

/** The value a slot shows: the card's when linked (or the slot has none), else its own. */
export function slotValue(slot: CompareSlot, linked: boolean, current: number): number {
  return linked || slot.value == null ? current : slot.value;
}

/**
 * Unlinking freezes every slot at the value it showed; linking drops the
 * slots' own values so they follow the card's slider again.
 */
export function setLinked(slots: readonly CompareSlot[], linked: boolean, current: number): CompareSlot[] {
  return slots.map((s) => (linked ? { pane: s.pane } : { pane: s.pane, value: s.value ?? current }));
}
