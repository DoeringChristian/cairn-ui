/**
 * The workspace document (pure): one of the project's views
 * (lib/workspace/views.ts) — a layout written in metric names and regexes,
 * never in runs, plus the project workspace's run state (which runs its
 * sidebar lists and its cards draw, lib/workspace-runs/state.ts). The run
 * page shows the current view bound to whichever run is being viewed and
 * ignores the run state; the workspace page (pages/WorkspacePage.tsx) uses
 * both. Both render the layout with components/workspace/WorkspaceView.tsx.
 *
 * Edits are ops, not snapshots, so a write that loses a race (409, see
 * sync.ts) is rebased by replaying the pending ops onto the server's
 * document: `rebase(server, pending)`.
 *
 * Panels the document does not list are derived automatically from the
 * bound runs' metrics (lib/workspace/layout.ts) while `autoPanels` is on.
 * Touching one materializes it here; removing one records its metric in
 * `removed`. Several panels may show the same metric (a line chart and a
 * value tile of `loss`, two image cards of `samples` with different
 * settings).
 */

import { CARD_TYPES, type CardType } from "../cards/card-spec.ts";
import { DEFAULT_RUN_STATE, parseRunState, type RunState } from "../workspace-runs/state.ts";

/** Per-card-type default values (the same shape as `settings-scope`'s `CardDefaults`). */
export type CardDefaults = Partial<Record<CardType, Record<string, unknown>>>;

/** Which metrics a panel shows: listed names, or an anchored regex over names. */
export type MetricSelector = { names: string[] } | { regex: string };

export interface Panel {
  /** Stable. Automatic panels are `auto:<metric>`, and keep that id when materialized. */
  id: string;
  type: CardType;
  selector: MetricSelector;
  /**
   * The card's own setting overrides (title, height, colSpan, smoothing, …).
   * Multi-run cards (bar, value tile, scatter, …) keep the series they show
   * here too (their expressions), with an empty selector.
   */
  settings: Record<string, unknown>;
  /** Kept in the layout (and still claiming its metric) but not rendered. */
  hidden?: boolean;
}

export interface SectionDef {
  id: string;
  name: string;
  collapsed: boolean;
  /** Panels shown A–Z by title instead of in their order. */
  sort: boolean;
  panels: Panel[];
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
  /** Regexes (panel-filter syntax): matching panels are hidden. */
  hidePatterns: string[];
  /** Ordered, named sections holding the materialized panels. */
  sections: SectionDef[];
  /** Metric names whose automatic panel was removed. */
  removed: string[];
  /**
   * Include unlisted metrics: metrics no panel claims get automatic panels.
   * Off: only the listed panels render; a metric logged later shows up in
   * "Manage cards" until added. Turning it off first writes the automatic
   * panels shown at that moment into the layout (layout.ts `autoPanelsOp`).
   */
  autoPanels: boolean;
  prefs: WorkspacePrefs;
  /** The workspace page's runs (search, grouping, eyes, version picks); the run page ignores it. */
  runState: RunState;
}

export type WorkspaceOp = (doc: WorkspaceDoc) => WorkspaceDoc;

export const EMPTY_WORKSPACE: WorkspaceDoc = Object.freeze({
  version: 1,
  defaults: {},
  sectionDefaults: {},
  hidePatterns: [],
  sections: [],
  removed: [],
  autoPanels: true,
  prefs: { syncZoom: false, syncCursor: true, colorBy: null },
  runState: DEFAULT_RUN_STATE,
}) as WorkspaceDoc;

export const AUTO_PREFIX = "auto:";
/** The id of a metric's automatic panel. */
export const autoPanelId = (metric: string) => `${AUTO_PREFIX}${metric}`;
export const isAutoPanelId = (id: string) => id.startsWith(AUTO_PREFIX);

/** The one metric a panel stands in for (its selector names exactly one), else null. */
export function claimedMetric(panel: Pick<Panel, "selector">): string | null {
  return "names" in panel.selector && panel.selector.names.length === 1 ? panel.selector.names[0]! : null;
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const unique = (xs: string[]) => Array.from(new Set(xs));

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

function selectorOf(v: unknown): MetricSelector | null {
  if (!isObj(v)) return null;
  if (typeof v.regex === "string") return { regex: v.regex };
  if (Array.isArray(v.names)) return { names: unique(strings(v.names)) };
  return null;
}

function panelOf(v: unknown): Panel | null {
  if (!isObj(v) || typeof v.id !== "string" || !v.id) return null;
  if (typeof v.type !== "string" || !(CARD_TYPES as readonly string[]).includes(v.type)) return null;
  const selector = selectorOf(v.selector);
  if (!selector) return null;
  const panel: Panel = { id: v.id, type: v.type as CardType, selector, settings: isObj(v.settings) ? v.settings : {} };
  if (v.hidden === true) panel.hidden = true;
  return panel;
}

function sectionsOf(v: unknown): SectionDef[] {
  if (!Array.isArray(v)) return [];
  const seenSections = new Set<string>();
  const seenPanels = new Set<string>();
  const out: SectionDef[] = [];
  for (const s of v) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.name !== "string") continue;
    if (seenSections.has(s.id) || out.some((o) => o.name === s.name)) continue;
    seenSections.add(s.id);
    const panels: Panel[] = [];
    for (const p of Array.isArray(s.panels) ? s.panels : []) {
      const panel = panelOf(p);
      if (!panel || seenPanels.has(panel.id)) continue;
      seenPanels.add(panel.id);
      panels.push(panel);
    }
    out.push({ id: s.id, name: s.name, collapsed: s.collapsed === true, sort: s.sort === true, panels });
  }
  return out;
}

/** Coerce anything (a server payload, null) into a valid document. */
export function normalizeWorkspace(raw: unknown): WorkspaceDoc {
  if (!isObj(raw)) return EMPTY_WORKSPACE;
  const prefs = isObj(raw.prefs) ? raw.prefs : {};
  const sectionDefaults: Record<string, CardDefaults> = {};
  if (isObj(raw.sectionDefaults)) {
    for (const [name, d] of Object.entries(raw.sectionDefaults)) sectionDefaults[name] = defaultsOf(d);
  }
  return {
    version: 1,
    defaults: defaultsOf(raw.defaults),
    sectionDefaults,
    hidePatterns: unique(strings(raw.hidePatterns)),
    sections: sectionsOf(raw.sections),
    removed: unique(strings(raw.removed)),
    autoPanels: raw.autoPanels !== false,
    prefs: {
      syncZoom: typeof prefs.syncZoom === "boolean" ? prefs.syncZoom : EMPTY_WORKSPACE.prefs.syncZoom,
      syncCursor: typeof prefs.syncCursor === "boolean" ? prefs.syncCursor : EMPTY_WORKSPACE.prefs.syncCursor,
      colorBy: colorByOf(prefs.colorBy),
    },
    runState: parseRunState(raw.runState),
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

let idCounter = 0;
/** A short random id for new sections and panels. */
export function newLayoutId(prefix: string): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${rand}${idCounter.toString(36)}`;
}

const union = (a: string[], b: readonly string[]) => [...a, ...b.filter((x) => !a.includes(x))];

function withType(defaults: CardDefaults, type: CardType, values: Record<string, unknown>): CardDefaults {
  const next: CardDefaults = { ...defaults };
  if (Object.keys(values).length === 0) delete next[type];
  else next[type] = values;
  return next;
}

function mapSection(d: WorkspaceDoc, name: string, fn: (s: SectionDef) => SectionDef): WorkspaceDoc {
  if (!d.sections.some((s) => s.name === name)) return d;
  return { ...d, sections: d.sections.map((s) => (s.name === name ? fn(s) : s)) };
}

function mapPanel(d: WorkspaceDoc, id: string, fn: (p: Panel) => Panel): WorkspaceDoc {
  let hit = false;
  const sections = d.sections.map((s) => {
    if (!s.panels.some((p) => p.id === id)) return s;
    hit = true;
    return { ...s, panels: s.panels.map((p) => (p.id === id ? fn(p) : p)) };
  });
  return hit ? { ...d, sections } : d;
}

/** Remove panel `id` wherever it is; returns the doc and the panel (if found). */
function takePanel(d: WorkspaceDoc, id: string): [WorkspaceDoc, Panel | null] {
  let found: Panel | null = null;
  const sections = d.sections.map((s) => {
    const p = s.panels.find((x) => x.id === id);
    if (!p) return s;
    found = p;
    return { ...s, panels: s.panels.filter((x) => x.id !== id) };
  });
  return [found ? { ...d, sections } : d, found];
}

function newSection(name: string): SectionDef {
  return { id: newLayoutId("s_"), name, collapsed: false, sort: false, panels: [] };
}

function allPanelIds(d: WorkspaceDoc): Set<string> {
  return new Set(d.sections.flatMap((s) => s.panels.map((p) => p.id)));
}

/** Find a panel and the name of its section. */
export function findPanel(d: WorkspaceDoc, id: string): { panel: Panel; section: string } | null {
  for (const s of d.sections) {
    const panel = s.panels.find((p) => p.id === id);
    if (panel) return { panel, section: s.name };
  }
  return null;
}

export const ops = {
  /** Apply several ops as one. */
  seq: (...list: WorkspaceOp[]): WorkspaceOp => (d) => list.reduce((doc, op) => op(doc), d),

  // --- sections ------------------------------------------------------------
  /**
   * Make sure each of `names` has a section, in this order relative to each
   * other: a missing one is inserted right after the previous name's section
   * (or first). Used before touching an automatic section so the page keeps
   * its arrangement.
   */
  ensureSections: (names: readonly string[]): WorkspaceOp => (d) => {
    let sections = d.sections;
    let prevIndex = -1;
    for (const name of names) {
      const at = sections.findIndex((s) => s.name === name);
      if (at >= 0) {
        prevIndex = at;
        continue;
      }
      sections = [...sections.slice(0, prevIndex + 1), newSection(name), ...sections.slice(prevIndex + 1)];
      prevIndex += 1;
    }
    return sections === d.sections ? d : { ...d, sections };
  },
  /** Add an empty section (a name already taken is a no-op). `index` null appends. */
  addSection: (name: string, index: number | null = null): WorkspaceOp => (d) => {
    const n = name.trim();
    if (!n || d.sections.some((s) => s.name === n)) return d;
    const sections = [...d.sections];
    sections.splice(index == null ? sections.length : Math.max(0, Math.min(index, sections.length)), 0, newSection(n));
    return { ...d, sections };
  },
  /** Rename a section; its section defaults follow. Taking another section's name is a no-op. */
  renameSection: (from: string, to: string): WorkspaceOp => (d) => {
    const n = to.trim();
    if (!n || n === from || d.sections.some((s) => s.name === n)) return d;
    const next = mapSection(d, from, (s) => ({ ...s, name: n }));
    if (next === d) return d;
    const sectionDefaults = { ...next.sectionDefaults };
    if (sectionDefaults[from]) {
      sectionDefaults[n] = sectionDefaults[from]!;
      delete sectionDefaults[from];
    }
    return { ...next, sectionDefaults };
  },
  /** Move a section by `delta` places (−1 up, +1 down), clamped. */
  moveSection: (name: string, delta: number): WorkspaceOp => (d) => {
    const from = d.sections.findIndex((s) => s.name === name);
    if (from < 0) return d;
    const to = Math.max(0, Math.min(d.sections.length - 1, from + delta));
    if (to === from) return d;
    const sections = [...d.sections];
    const [s] = sections.splice(from, 1);
    sections.splice(to, 0, s!);
    return { ...d, sections };
  },
  /** Move a section right before section `beforeName` (null: last). */
  placeSection: (name: string, beforeName: string | null): WorkspaceOp => (d) => {
    if (name === beforeName) return d;
    const s = d.sections.find((x) => x.name === name);
    if (!s) return d;
    const sections = d.sections.filter((x) => x !== s);
    const at = beforeName == null ? -1 : sections.findIndex((x) => x.name === beforeName);
    sections.splice(at < 0 ? sections.length : at, 0, s);
    return sections.every((x, i) => x === d.sections[i]) ? d : { ...d, sections };
  },
  /** Remove a section that holds no panels. */
  removeSection: (name: string): WorkspaceOp => (d) => {
    const s = d.sections.find((x) => x.name === name);
    if (!s || s.panels.length > 0) return d;
    return { ...d, sections: d.sections.filter((x) => x.name !== name) };
  },
  setSectionCollapsed: (name: string, collapsed: boolean): WorkspaceOp => (d) =>
    mapSection(d, name, (s) => (s.collapsed === collapsed ? s : { ...s, collapsed })),
  setSectionSorted: (name: string, sort: boolean): WorkspaceOp => (d) =>
    mapSection(d, name, (s) => (s.sort === sort ? s : { ...s, sort })),

  // --- panels --------------------------------------------------------------
  /**
   * Add panels to section `name` (created at the end if missing), at `index`
   * (null: the end). Ids already in the document are skipped, so writing an
   * automatic panel twice (materializing) is idempotent.
   */
  addPanels: (name: string, panels: readonly Panel[], index: number | null = null): WorkspaceOp => (d) => {
    const taken = allPanelIds(d);
    const fresh = panels.filter((p) => !taken.has(p.id));
    if (fresh.length === 0) return d;
    const base = d.sections.some((s) => s.name === name) ? d : ops.addSection(name)(d);
    // A panel that stands in for a metric brings it back from "removed".
    const claimed = fresh.map(claimedMetric).filter((m): m is string => m != null);
    const removed = claimed.length ? base.removed.filter((m) => !claimed.includes(m)) : base.removed;
    return {
      ...mapSection(base, name, (s) => {
        const list = [...s.panels];
        list.splice(index == null ? list.length : Math.max(0, Math.min(index, list.length)), 0, ...fresh);
        return { ...s, panels: list };
      }),
      removed,
    };
  },
  /**
   * Remove a panel. `claimed` (the metric it stands in for, see
   * `claimedMetric`, or an automatic panel's metric) is recorded in
   * `removed` so its automatic panel does not come back.
   */
  removePanel: (id: string, claimed: string | null): WorkspaceOp => (d) => {
    const [next] = takePanel(d, id);
    return claimed ? { ...next, removed: union(next.removed, [claimed]) } : next;
  },
  /** Bring back removed metrics' automatic panels. */
  restoreRemoved: (names: readonly string[]): WorkspaceOp => (d) => ({
    ...d,
    removed: d.removed.filter((m) => !names.includes(m)),
  }),
  /**
   * Copy panel `id` (type, selector, settings) right after it as `newId`.
   * An automatic panel must be materialized first.
   */
  duplicatePanel: (id: string, newId: string): WorkspaceOp => (d) => {
    if (allPanelIds(d).has(newId)) return d;
    let hit = false;
    const sections = d.sections.map((s) => {
      const at = s.panels.findIndex((p) => p.id === id);
      if (at < 0) return s;
      hit = true;
      const src = s.panels[at]!;
      const copy: Panel = { ...src, id: newId, settings: structuredClone(src.settings) };
      delete copy.hidden;
      const panels = [...s.panels];
      panels.splice(at + 1, 0, copy);
      return { ...s, panels };
    });
    return hit ? { ...d, sections } : d;
  },
  /** Hide a listed panel (it keeps its place, settings and claim) or show it again. */
  setPanelHidden: (id: string, hidden: boolean): WorkspaceOp => (d) => {
    const found = findPanel(d, id);
    if (!found || !!found.panel.hidden === hidden) return d;
    return mapPanel(d, id, (p) => {
      const next = { ...p };
      if (hidden) next.hidden = true;
      else delete next.hidden;
      return next;
    });
  },
  /** Replace a panel's type, selector and settings at once (the card builder's "save"). */
  replacePanel: (id: string, patch: Pick<Panel, "type" | "selector" | "settings">): WorkspaceOp => (d) =>
    mapPanel(d, id, (p) => ({ ...p, type: patch.type, selector: patch.selector, settings: patch.settings })),
  setPanelSettings: (id: string, settings: Record<string, unknown>): WorkspaceOp => (d) =>
    mapPanel(d, id, (p) => ({ ...p, settings })),
  setPanelType: (id: string, type: CardType): WorkspaceOp => (d) =>
    mapPanel(d, id, (p) => (p.type === type ? p : { ...p, type })),
  setPanelSelector: (id: string, selector: MetricSelector): WorkspaceOp => (d) =>
    mapPanel(d, id, (p) => ({ ...p, selector })),
  /** Move a panel to section `to` (created at the end if missing), before `beforeId` (null: the end). */
  movePanel: (id: string, to: string, beforeId: string | null): WorkspaceOp => (d) => {
    if (id === beforeId) return d;
    const [without, panel] = takePanel(d, id);
    if (!panel) return d;
    const base = without.sections.some((s) => s.name === to) ? without : ops.addSection(to)(without);
    return mapSection(base, to, (s) => {
      const list = [...s.panels];
      const at = beforeId == null ? -1 : list.findIndex((p) => p.id === beforeId);
      list.splice(at < 0 ? list.length : at, 0, panel);
      return { ...s, panels: list };
    });
  },

  // --- defaults, hide patterns, prefs --------------------------------------
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
  addHidePattern: (pattern: string): WorkspaceOp => (d) => ({ ...d, hidePatterns: union(d.hidePatterns, [pattern]) }),
  removeHidePattern: (pattern: string): WorkspaceOp => (d) => ({
    ...d,
    hidePatterns: d.hidePatterns.filter((p) => p !== pattern),
  }),
  setPrefs: (patch: Partial<WorkspacePrefs>): WorkspaceOp => (d) => ({ ...d, prefs: { ...d.prefs, ...patch } }),
  /** Only the flag; turning it off from the UI goes through layout.ts `autoPanelsOp` (materializes first). */
  setAutoPanels: (on: boolean): WorkspaceOp => (d) => (d.autoPanels === on ? d : { ...d, autoPanels: on }),

  // --- the workspace page's runs -------------------------------------------
  /** Edit the run state (lib/workspace-runs/state.ts edits); an unchanged state is a no-op. */
  updateRunState: (fn: (s: RunState) => RunState): WorkspaceOp => (d) => {
    const runState = fn(d.runState);
    return JSON.stringify(runState) === JSON.stringify(d.runState) ? d : { ...d, runState };
  },
};
