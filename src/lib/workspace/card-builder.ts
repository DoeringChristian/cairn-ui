/**
 * The card builder (pure): what the builder dialog
 * (components/workspace/CardBuilder.tsx) offers and writes.
 *
 * - **Data**: the series of the bound runs, grouped by their automatic
 *   section, each with the cards that already show it; picked by name (one
 *   or several), by an anchored regex, or "whole runs" (no series: the run
 *   comparer, code diff, …).
 * - **Card types**: those that can show the picked data. A per-metric card
 *   shows series of its own kind (`image` series → image card); scalars can
 *   also feed the multi-run cards (value tile, bar, scatter, parallel
 *   coordinates, importance), which read one value per run through an
 *   expression (`last(loss)`). A type the bound runs are too few for stays
 *   listed with "needs 2+ runs".
 * - **Seeding**: a new panel's selector and settings for a (type, data)
 *   pair. Multi-run panels keep an empty selector; their series live in
 *   their settings' expressions, which `panelData` reads back.
 * - **Catalogue**: every card of a workspace — listed, hidden, automatic,
 *   removed and (with unlisted metrics off) not shown — for "Manage cards".
 */

import type { CardType } from "../cards/card-spec.ts";
import { isMultiRunCardType, minRunsFor } from "../comparisons/types.ts";
import { deps, parse } from "../expr/index.ts";
import { quoteMetric } from "../scalar-exprs.ts";
import { autoSectionOf, compareAutoSections } from "../sections.ts";
import type { MetricSelector, Panel, WorkspaceDoc } from "./doc.ts";
import { compileSelectorRegex, deriveLayout, panelLabel, type MetricInfo, type RenderedSection } from "./layout.ts";
import { compilePanelFilter, matchesAnyPattern } from "./panel-filter.ts";

/** What a card shows. */
export type BuilderData =
  | { mode: "series"; names: string[] }
  | { mode: "regex"; regex: string }
  | { mode: "runs" };

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Partial<Record<CardType, string>> = {
  scalar: "Line chart",
  tile: "Value",
  bar: "Bar chart",
  scatter: "Scatter",
  parallel: "Parallel coordinates",
  importance: "Parameter importance",
  "run-compare": "Run comparer",
  "code-diff": "Code diff",
  pointcloud: "Point cloud",
  boxes3d: "3D boxes",
  preset: "Confusion / PR / ROC",
  html: "HTML",
};

const TYPE_HINTS: Partial<Record<CardType, string>> = {
  scalar: "The series over steps, one line per run.",
  tile: "One number: the last value, reduced across runs.",
  bar: "One bar per run: the last value.",
  scatter: "One point per run: x and y from the last values.",
  parallel: "One axis per series, one line per run.",
  importance: "Which config values drive this series.",
  "run-compare": "Config, summary and metadata side by side.",
  "code-diff": "The source of two runs, diffed.",
};

export function builderTypeLabel(type: CardType): string {
  return TYPE_LABELS[type] ?? type[0]!.toUpperCase() + type.slice(1);
}

/** Short labels of the series kinds (the badges of the data step). */
export function kindLabel(kind: string): string {
  return kind === "scalar" ? "scalar" : kind === "boxes3d" ? "3d boxes" : kind;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The expressions a multi-run card reads its series from, by settings key. */
function multiRunExprs(type: CardType, settings: Record<string, unknown>): string[] {
  const src = (v: unknown) =>
    v && typeof v === "object" && typeof (v as { src?: unknown }).src === "string" ? [(v as { src: string }).src] : [];
  switch (type) {
    case "tile":
    case "bar":
    case "importance":
      return src(settings.metric);
    case "scatter":
      return [...src(settings.x), ...src(settings.y)];
    case "parallel":
      return Array.isArray(settings.columns) ? settings.columns.flatMap(src) : [];
    default:
      return [];
  }
}

/** The metric series a multi-run card's settings read (unique, in order). */
export function multiRunSeries(type: CardType, settings: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const e of multiRunExprs(type, settings)) {
    try {
      for (const m of deps(parse(e)).metrics) if (!out.includes(m)) out.push(m);
    } catch {
      /* an expression that does not parse reads nothing */
    }
  }
  return out;
}

/** The data a panel shows, as the builder edits it. */
export function panelData(panel: Pick<Panel, "type" | "selector" | "settings">): BuilderData {
  if (isMultiRunCardType(panel.type)) {
    const names = multiRunSeries(panel.type, panel.settings);
    return names.length ? { mode: "series", names } : { mode: "runs" };
  }
  return "regex" in panel.selector ? { mode: "regex", regex: panel.selector.regex } : { mode: "series", names: [...panel.selector.names] };
}

export type RegexResult = { ok: true; matches: MetricInfo[] } | { ok: false; error: string };

/** The metrics an (anchored) regex matches, A–Z. */
export function regexMatches(regex: string, metrics: readonly MetricInfo[]): RegexResult {
  const r = regex.trim();
  if (!r) return { ok: false, error: "Enter a regular expression" };
  const re = compileSelectorRegex(r);
  if (!re) return { ok: false, error: "Not a valid regular expression" };
  return { ok: true, matches: metrics.filter((m) => re.test(m.name)).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** The metrics of the bound runs the data resolves to. */
export function dataMetrics(data: BuilderData, metrics: readonly MetricInfo[]): MetricInfo[] {
  if (data.mode === "runs") return [];
  if (data.mode === "regex") {
    const r = regexMatches(data.regex, metrics);
    return r.ok ? r.matches : [];
  }
  const byName = new Map(metrics.map((m) => [m.name, m]));
  return data.names.map((n) => byName.get(n)).filter((m): m is MetricInfo => m != null);
}

/** Whether there is anything picked. */
export function dataReady(data: BuilderData): boolean {
  if (data.mode === "runs") return true;
  if (data.mode === "regex") return compileSelectorRegex(data.regex.trim()) != null && data.regex.trim() !== "";
  return data.names.length > 0;
}

export function sameData(a: BuilderData, b: BuilderData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A short description of the data: `loss`, `loss + 2 more`, `/val\..*\/`, `whole runs`. */
export function dataLabel(data: BuilderData): string {
  if (data.mode === "runs") return "whole runs";
  if (data.mode === "regex") return `/${data.regex}/`;
  const [first, ...rest] = data.names;
  return rest.length ? `${first} + ${rest.length} more` : (first ?? "");
}

// ---------------------------------------------------------------------------
// Which cards show which series
// ---------------------------------------------------------------------------

/** Metric name → labels of the rendered cards that show it (automatic ones included). */
export function seriesShownBy(sections: readonly RenderedSection[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, label: string) => {
    const list = out.get(name) ?? [];
    list.push(label);
    out.set(name, list);
  };
  for (const s of sections) for (const rp of s.panels) {
    const names = isMultiRunCardType(rp.panel.type) ? multiRunSeries(rp.panel.type, rp.panel.settings) : rp.metrics.map((m) => m.name);
    const label = `${rp.label} (${builderTypeLabel(rp.panel.type)})`;
    for (const n of names) add(n, label);
  }
  return out;
}

export interface SeriesItem {
  name: string;
  kind: string;
  /** Bound runs that log it. */
  runs: number;
  /** Labels of the cards already showing it. */
  shownBy: string[];
}

export interface SeriesGroup {
  name: string;
  items: SeriesItem[];
}

/**
 * The data step's list: every series of the bound runs, grouped by its
 * automatic section (Charts, prefix sections A–Z, Media, system), A–Z inside.
 * `query` filters by name (panel-filter syntax: a case-insensitive regex,
 * plain text when it is not one).
 */
export function seriesCatalogue(
  metrics: readonly MetricInfo[],
  shownBy: ReadonlyMap<string, readonly string[]>,
  query = "",
): SeriesGroup[] {
  const f = compilePanelFilter(query);
  const groups = new Map<string, SeriesItem[]>();
  for (const m of [...metrics].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.test(m.name)) continue;
    const g = autoSectionOf(m.name, m.object_type);
    const list = groups.get(g) ?? [];
    list.push({ name: m.name, kind: m.object_type, runs: m.runIds.length, shownBy: [...(shownBy.get(m.name) ?? [])] });
    groups.set(g, list);
  }
  return [...groups.keys()].sort(compareAutoSections).map((name) => ({ name, items: groups.get(name)! }));
}

// ---------------------------------------------------------------------------
// Compatible card types
// ---------------------------------------------------------------------------

export interface TypeOption {
  type: CardType;
  label: string;
  hint: string;
  /** Why it cannot be added now (too few runs, too many series), else null. */
  unavailable: string | null;
}

/** Per-metric card types that draw one series only. */
const SINGLE_SERIES = new Set<string>(["histogram", "tensor", "text", "artifact"]);
/** Per-metric card types (a series kind renders as the card of its own kind). */
const SERIES_TYPES = new Set<string>([
  "scalar", "image", "figure", "audio", "video", "histogram", "tensor", "text", "pointcloud", "mesh", "boxes3d",
  "volume", "preset", "table", "html", "markdown", "artifact",
]);
/** Multi-run cards scalars can feed: [type, fewest series, most series]. */
const SCALAR_MULTI_RUN: Array<[CardType, number, number]> = [
  ["tile", 1, 1],
  ["bar", 1, 1],
  ["scatter", 1, 2],
  ["parallel", 1, Infinity],
  ["importance", 1, 1],
];
/** Cards without series: they compare whole runs. */
const RUN_TYPES: CardType[] = ["run-compare", "code-diff", "parallel", "scatter", "bar", "tile", "importance"];

export interface CompatResult {
  options: TypeOption[];
  /** Why nothing fits (mixed kinds, nothing picked), else null. */
  reason: string | null;
}

/**
 * The card types that can show `data` for `runCount` bound runs.
 * `keepType` (the type of a card being edited) is always offered.
 */
export function compatibleTypes(
  data: BuilderData,
  metrics: readonly MetricInfo[],
  runCount: number,
  keepType: CardType | null = null,
): CompatResult {
  const runsNote = (t: CardType) => {
    const need = minRunsFor(t);
    return runCount < need ? `needs ${need}+ runs` : null;
  };
  const opt = (type: CardType, unavailable: string | null): TypeOption => ({
    type,
    label: builderTypeLabel(type),
    hint: TYPE_HINTS[type] ?? `The ${builderTypeLabel(type).toLowerCase()} card of this series.`,
    unavailable: unavailable ?? runsNote(type),
  });
  const withKeep = (r: CompatResult): CompatResult =>
    keepType && !r.options.some((o) => o.type === keepType) ? { ...r, options: [opt(keepType, null), ...r.options] } : r;

  if (data.mode === "runs") return withKeep({ options: RUN_TYPES.map((t) => opt(t, null)), reason: null });
  if (!dataReady(data)) return withKeep({ options: [], reason: "Pick the data first." });

  const resolved = dataMetrics(data, metrics);
  const kinds = [...new Set(resolved.map((m) => m.object_type))];
  if (kinds.length === 0) {
    return withKeep({ options: [], reason: "None of the bound runs logs this data (yet)." });
  }
  if (kinds.length > 1) {
    return withKeep({ options: [], reason: `These series are of different kinds (${kinds.join(", ")}): pick one kind.` });
  }
  const kind = kinds[0]!;
  const count = data.mode === "series" ? data.names.length : resolved.length;
  const options: TypeOption[] = [];
  if (SERIES_TYPES.has(kind)) {
    const type = kind as CardType;
    options.push(opt(type, SINGLE_SERIES.has(kind) && count > 1 ? "shows one series" : null));
  }
  if (kind === "scalar" && data.mode === "series") {
    for (const [type, lo, hi] of SCALAR_MULTI_RUN) {
      const n = count < lo || count > hi ? (hi === 1 ? "shows one series" : `takes ${lo}–${hi} series`) : null;
      options.push(opt(type, n));
    }
  }
  return withKeep({ options, reason: options.length ? null : `No card shows ${kind} series.` });
}

// ---------------------------------------------------------------------------
// Seeding panels
// ---------------------------------------------------------------------------

const lastOf = (name: string) => ({ src: `last(${quoteMetric(name)})` });

/** The settings a multi-run card reads `names` through (`last(<name>)`). */
export function multiRunSeed(type: CardType, names: readonly string[]): Record<string, unknown> {
  if (names.length === 0) return {};
  switch (type) {
    case "tile":
    case "bar":
    case "importance":
      return { metric: lastOf(names[0]!) };
    case "scatter":
      return names.length >= 2 ? { x: lastOf(names[0]!), y: lastOf(names[1]!) } : { y: lastOf(names[0]!) };
    case "parallel":
      return { columns: names.map(lastOf) };
    default:
      return {};
  }
}

/**
 * The selector and settings of a card of `type` showing `data`, keeping
 * `settings` (an edited card's, a draft's) except the keys the data sets.
 * A multi-run card whose settings already read exactly that data keeps
 * them (`min(loss)` stays `min(loss)`).
 */
export function seedPanel(
  type: CardType,
  data: BuilderData,
  settings: Record<string, unknown> = {},
): { selector: MetricSelector; settings: Record<string, unknown> } {
  if (isMultiRunCardType(type)) {
    const names = data.mode === "series" ? data.names : [];
    const current = multiRunSeries(type, settings);
    const same = current.length === names.length && current.every((n, i) => n === names[i]);
    return { selector: { names: [] }, settings: same ? settings : { ...settings, ...multiRunSeed(type, names) } };
  }
  const selector: MetricSelector = data.mode === "regex" ? { regex: data.regex.trim() } : { names: data.mode === "series" ? [...data.names] : [] };
  return { selector, settings };
}

/** The title a new card starts with: multi-run cards name their data (`loss · Value`); others none. */
export function defaultTitle(type: CardType, data: BuilderData): string {
  if (!isMultiRunCardType(type) || data.mode !== "series" || data.names.length === 0) return "";
  return `${data.names.join(", ")} · ${builderTypeLabel(type)}`;
}

// ---------------------------------------------------------------------------
// The "Manage cards" catalogue
// ---------------------------------------------------------------------------

/**
 * - `listed`: a panel of the layout, shown;
 * - `hidden`: a panel of the layout, hidden (`panel.hidden`);
 * - `auto`: an automatic panel (not in the layout yet);
 * - `removed`: an automatic panel that was removed (`doc.removed`);
 * - `unlisted`: unlisted metrics are off and no panel shows this metric.
 */
export type CardStatus = "listed" | "hidden" | "auto" | "removed" | "unlisted";

export interface CatalogueEntry {
  /** Unique within the catalogue. */
  key: string;
  status: CardStatus;
  /** The panel (an automatic one for `auto` / `removed` / `unlisted`). */
  panel: Panel;
  section: string;
  label: string;
  /** A hide pattern hides it. */
  patternHidden: boolean;
}

export function cardCatalogue(doc: WorkspaceDoc, metrics: readonly MetricInfo[]): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  const push = (status: CardStatus, panel: Panel, section: string) => {
    const label = panelLabel(panel);
    out.push({
      key: `${status}:${panel.id}`,
      status,
      panel,
      section,
      label,
      patternHidden: matchesAnyPattern(label, doc.hidePatterns),
    });
  };
  const rendered = deriveLayout(doc, metrics, { hidePatterns: false });
  const autosOf = (name: string) => rendered.find((s) => s.name === name)?.panels.filter((p) => p.auto) ?? [];
  for (const s of doc.sections) {
    for (const p of s.panels) push(p.hidden ? "hidden" : "listed", p, s.name);
    for (const rp of autosOf(s.name)) push("auto", rp.panel, s.name);
  }
  for (const s of rendered) if (!s.inDoc) for (const rp of s.panels) push("auto", rp.panel, s.name);
  if (!doc.autoPanels) {
    const would = deriveLayout({ ...doc, autoPanels: true }, metrics, { hidePatterns: false });
    for (const s of would) for (const rp of s.panels) if (rp.auto) push("unlisted", rp.panel, s.name);
  }
  const byName = new Map(metrics.map((m) => [m.name, m]));
  for (const name of [...doc.removed].sort()) {
    const m = byName.get(name);
    const kind = m?.object_type ?? "scalar";
    push("removed", { id: `auto:${name}`, type: kind as CardType, selector: { names: [name] }, settings: {} }, autoSectionOf(name, kind));
  }
  return out;
}

/** The section a "show" of an automatic metric's card lands in. */
export function autoSectionOfPanel(panel: Panel, metrics: readonly MetricInfo[]): string {
  const name = "names" in panel.selector ? panel.selector.names[0] : undefined;
  const m = metrics.find((x) => x.name === name);
  return autoSectionOf(name ?? "", m?.object_type ?? panel.type);
}
