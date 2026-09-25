/**
 * The project workspace document (pure): what the run page and comparisons
 * share per project, stored on the server (`/api/projects/{pid}/workspace`)
 * and edited through `WorkspaceOp`s.
 *
 * Edits are ops, not snapshots, so a write that loses a race (409, see
 * sync.ts) is rebased by replaying the pending ops onto the server's
 * document: `rebase(server, pending)`. The run view (hidden/pinned/baseline
 * runs) is per-browser and does not live here (lib/run-view-store.ts).
 */

import type { CardType } from "../cards/card-spec.ts";

/** Per-card-type default values (the same shape as `settings-scope`'s `CardDefaults`). */
export type CardDefaults = Partial<Record<CardType, Record<string, unknown>>>;

/** A card built by the quick panel builder: several metrics on one scalar chart. */
export interface CustomPanel {
  id: string;
  title: string;
  type: "scalar";
  metrics: string[];
}

/** The palettes a colour-by samples (charts/colormaps.ts). */
export const COLOR_BY_PALETTES = ["turbo", "viridis", "magma"] as const;
export type ColorByPalette = (typeof COLOR_BY_PALETTES)[number];
export const COLOR_BY_BUCKETS = { min: 2, max: 8 } as const;

/** Colour runs by a value (lib/run-color-by.ts): `expr` per run, bucketed into `buckets` colours of `palette`. */
export interface ColorBy {
  /** A scalar expression (`config.lr`, `min(val.loss)`, `run.group`). */
  expr: string;
  /** 2–8. */
  buckets: number;
  palette: ColorByPalette;
}

export interface WorkspacePrefs {
  /** Charts sharing an x-axis zoom together (lib/chart-sync.tsx). */
  syncZoom: boolean;
  /** Charts sharing an x-axis show the hover cursor together. */
  syncCursor: boolean;
  /** Colour every run in charts by a value instead of its id; null: by id. */
  colorBy: ColorBy | null;
}

export interface WorkspaceDoc {
  version: 1;
  /** Workspace-wide card defaults, per card type (cascade keys only). */
  defaults: CardDefaults;
  /** Per-section card defaults, keyed by section name. */
  sectionDefaults: Record<string, CardDefaults>;
  /** Card keys (metric names) removed from the run page's view. */
  hiddenCards: string[];
  /** Regexes (panel-filter syntax): matching cards are hidden. */
  hidePatterns: string[];
  sections: {
    /** Sections shown first, in this order. */
    pinned: string[];
    /** Sections whose cards are sorted A–Z by name. */
    sort: string[];
  };
  customPanels: CustomPanel[];
  prefs: WorkspacePrefs;
}

export type WorkspaceOp = (doc: WorkspaceDoc) => WorkspaceDoc;

export const EMPTY_WORKSPACE: WorkspaceDoc = Object.freeze({
  version: 1,
  defaults: {},
  sectionDefaults: {},
  hiddenCards: [],
  hidePatterns: [],
  sections: { pinned: [], sort: [] },
  customPanels: [],
  prefs: { syncZoom: false, syncCursor: true, colorBy: null },
}) as WorkspaceDoc;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function defaultsOf(v: unknown): CardDefaults {
  if (!isObj(v)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, d] of Object.entries(v)) if (isObj(d)) out[k] = d;
  return out as CardDefaults;
}

function colorByOf(v: unknown): ColorBy | null {
  if (!isObj(v) || typeof v.expr !== "string" || v.expr.trim() === "") return null;
  const n = typeof v.buckets === "number" && Number.isFinite(v.buckets) ? Math.round(v.buckets) : 4;
  return {
    expr: v.expr,
    buckets: Math.min(COLOR_BY_BUCKETS.max, Math.max(COLOR_BY_BUCKETS.min, n)),
    palette: (COLOR_BY_PALETTES as readonly unknown[]).includes(v.palette) ? (v.palette as ColorByPalette) : "turbo",
  };
}

function isCustomPanel(v: unknown): v is CustomPanel {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    v.type === "scalar" &&
    Array.isArray(v.metrics) &&
    v.metrics.every((m) => typeof m === "string")
  );
}

/** Coerce anything (a server payload, a saved view, null) into a valid document. */
export function normalizeWorkspace(raw: unknown): WorkspaceDoc {
  if (!isObj(raw)) return EMPTY_WORKSPACE;
  const sections = isObj(raw.sections) ? raw.sections : {};
  const prefs = isObj(raw.prefs) ? raw.prefs : {};
  const sectionDefaults: Record<string, CardDefaults> = {};
  if (isObj(raw.sectionDefaults)) {
    for (const [name, d] of Object.entries(raw.sectionDefaults)) sectionDefaults[name] = defaultsOf(d);
  }
  return {
    version: 1,
    defaults: defaultsOf(raw.defaults),
    sectionDefaults,
    hiddenCards: strings(raw.hiddenCards),
    hidePatterns: strings(raw.hidePatterns),
    sections: { pinned: strings(sections.pinned), sort: strings(sections.sort) },
    customPanels: Array.isArray(raw.customPanels) ? raw.customPanels.filter(isCustomPanel) : [],
    prefs: {
      syncZoom: typeof prefs.syncZoom === "boolean" ? prefs.syncZoom : EMPTY_WORKSPACE.prefs.syncZoom,
      syncCursor: typeof prefs.syncCursor === "boolean" ? prefs.syncCursor : EMPTY_WORKSPACE.prefs.syncCursor,
      colorBy: colorByOf(prefs.colorBy),
    },
  };
}

/** Replay `pending` ops onto `base` (the server's document after a 409). */
export function rebase(base: WorkspaceDoc, pending: readonly WorkspaceOp[]): WorkspaceDoc {
  return pending.reduce((doc, op) => op(doc), base);
}

/** Top-level fields that differ between two documents. */
export function changedFields(a: WorkspaceDoc, b: WorkspaceDoc): (keyof WorkspaceDoc)[] {
  return (Object.keys(b) as (keyof WorkspaceDoc)[]).filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

/**
 * The op that undoes `before → after`: restore the fields that op changed to
 * their `before` values, leaving fields another tab changed since alone.
 */
export function restoreFields(before: WorkspaceDoc, fields: readonly (keyof WorkspaceDoc)[]): WorkspaceOp {
  return (doc) => {
    const next = { ...doc } as Record<string, unknown>;
    for (const f of fields) next[f] = before[f];
    return next as unknown as WorkspaceDoc;
  };
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

const union = (a: string[], b: readonly string[]) => [...a, ...b.filter((x) => !a.includes(x))];
const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

export const ops = {
  hideCards: (keys: readonly string[]): WorkspaceOp => (d) => ({ ...d, hiddenCards: union(d.hiddenCards, keys) }),
  showCards: (keys: readonly string[]): WorkspaceOp => (d) => ({
    ...d,
    hiddenCards: d.hiddenCards.filter((k) => !keys.includes(k)),
  }),
  showAllCards: (): WorkspaceOp => (d) => ({ ...d, hiddenCards: [] }),
  addHidePattern: (pattern: string): WorkspaceOp => (d) => ({ ...d, hidePatterns: union(d.hidePatterns, [pattern]) }),
  removeHidePattern: (pattern: string): WorkspaceOp => (d) => ({
    ...d,
    hidePatterns: d.hidePatterns.filter((p) => p !== pattern),
  }),
  togglePinned: (section: string): WorkspaceOp => (d) => ({
    ...d,
    sections: { ...d.sections, pinned: toggle(d.sections.pinned, section) },
  }),
  toggleSorted: (section: string): WorkspaceOp => (d) => ({
    ...d,
    sections: { ...d.sections, sort: toggle(d.sections.sort, section) },
  }),
  /** Replace one card type's workspace defaults (empty removes them). */
  setDefaults: (type: CardType, values: Record<string, unknown>): WorkspaceOp => (d) => ({
    ...d,
    defaults: withType(d.defaults, type, values),
  }),
  /** Replace one card type's defaults in one section (empty removes them). */
  setSectionDefaults: (section: string, type: CardType, values: Record<string, unknown>): WorkspaceOp => (d) => {
    const nextSection = withType(d.sectionDefaults[section] ?? {}, type, values);
    const sectionDefaults = { ...d.sectionDefaults, [section]: nextSection };
    if (Object.keys(nextSection).length === 0) delete sectionDefaults[section];
    return { ...d, sectionDefaults };
  },
  addCustomPanels: (panels: readonly CustomPanel[]): WorkspaceOp => (d) => ({
    ...d,
    customPanels: [...d.customPanels, ...panels],
  }),
  removeCustomPanel: (id: string): WorkspaceOp => (d) => ({
    ...d,
    customPanels: d.customPanels.filter((p) => p.id !== id),
  }),
  setPrefs: (patch: Partial<WorkspacePrefs>): WorkspaceOp => (d) => ({ ...d, prefs: { ...d.prefs, ...patch } }),
  /** Replace everything but the version (applying a saved view). */
  replace: (next: WorkspaceDoc): WorkspaceOp => () => next,
};

function withType(defaults: CardDefaults, type: CardType, values: Record<string, unknown>): CardDefaults {
  const next: CardDefaults = { ...defaults };
  if (Object.keys(values).length === 0) delete next[type];
  else next[type] = values;
  return next;
}
