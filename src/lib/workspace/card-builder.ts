/**
 * The card builder (pure): what the card editor
 * (components/workspace/CardEditor.tsx — adding a card and the gear alike)
 * offers and writes.
 *
 * - **Data**: the series of the bound runs, grouped by their automatic
 *   section, each with the cards that already show it; picked by name (one
 *   or several), by an anchored regex, or "whole runs" (no series: the run
 *   comparer, code diff, …). While adding, also **groups**: a regex whose
 *   capture groups split the matches into one card each (`newCards`).
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

import type { ViewerDefaults, ViewerInfo } from "../../api/types.ts";
import type { CardType } from "../cards/card-spec.ts";
import { defaultViewerName, VIEWER_DEFAULT_TYPES, viewersFor, type SeriesKind } from "../custom/viewers.ts";
import { isMultiRunCardType, minRunsFor } from "../comparisons/types.ts";
import { deps, parse } from "../expr/index.ts";
import { quoteMetric } from "../scalar-exprs.ts";
import { autoSectionOf, compareAutoSections } from "../sections.ts";
import type { MetricSelector, Panel, WorkspaceDoc } from "./doc.ts";
import { compileSelectorRegex, deriveLayout, panelLabel, type MetricInfo, type RenderedSection } from "./layout.ts";
import { compilePanelFilter, matchesAnyPattern } from "./panel-filter.ts";
import { summaryTypeOfName } from "./summary-cards.ts";

/** What a card shows (a panel's data, see `panelData`). */
export type PanelData =
  | { mode: "series"; names: string[] }
  | { mode: "regex"; regex: string }
  | { mode: "runs" };

/**
 * What the data picker picks: a panel's data, or — only while adding cards,
 * since it makes several — **groups**: a regex whose capture groups split
 * the matches into one card each. Metrics whose captures agree share a
 * card, so `(train|val)\.loss` makes one card per split and
 * `.*\.(loss|acc)` puts `train.loss` and `val.loss` on one card and the two
 * accuracies on another; without capture groups every match lands on one
 * card. Each group's card lists its metrics by name, titled by its captures
 * joined by " · ".
 */
export type CardData = PanelData | { mode: "groups"; regex: string };

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
  scalars: "Scalars",
  config: "Config",
  pointcloud: "Point cloud",
  boxes3d: "3D boxes",
  preset: "Confusion / PR / ROC",
  html: "HTML",
  custom: "Custom viewer",
};

const TYPE_HINTS: Partial<Record<CardType, string>> = {
  scalar: "The series over steps, one line per run.",
  tile: "One number: the last value, reduced across runs.",
  bar: "One bar per run: the last value.",
  scatter: "One point per run: x and y from the last values.",
  parallel: "One axis per varying config key, then the metric; one line per run.",
  importance: "Which config values drive this series.",
  "run-compare": "Config, summary and metadata side by side.",
  "code-diff": "The source of two runs, diffed.",
  scalars: "Single-step metrics, summary values and run info: one row per run.",
  config: "The config, tags and notes: one column per run.",
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
      return src(settings.metric);
    case "scatter":
      return [...src(settings.x), ...src(settings.y)];
    default:
      return [];
  }
}

/** The metric series a multi-run card's settings read (unique, in order). */
export function multiRunSeries(type: CardType, settings: Record<string, unknown>): string[] {
  // A metric by name (its final value under the project's rule).
  if (type === "importance" || type === "parallel") return typeof settings.metric === "string" ? [settings.metric] : [];
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
export function panelData(panel: Pick<Panel, "type" | "selector" | "settings">): PanelData {
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

/** One card of a capture-group regex. */
export interface CardGroup {
  /** The capture-group values joined by " · ", or the pattern when it has none. */
  title: string;
  /** Matched metric names, A–Z. */
  names: string[];
}

export type GroupsResult = { ok: true; groups: CardGroup[] } | { ok: false; error: string };

/** Split the metrics an (anchored) regex matches by their capture-group values, groups A–Z by title. */
export function captureGroups(pattern: string, metrics: readonly Pick<MetricInfo, "name">[]): GroupsResult {
  const p = pattern.trim();
  if (!p) return { ok: false, error: "Enter a regular expression" };
  const re = compileSelectorRegex(p);
  if (!re) return { ok: false, error: "Not a valid regular expression" };
  const groups = new Map<string, string[]>();
  for (const name of [...new Set(metrics.map((m) => m.name))].sort()) {
    const m = re.exec(name);
    if (!m) continue;
    const captures = m.slice(1);
    const key = captures.length === 0 ? p : captures.map((c) => c ?? "").join(" · ");
    const list = groups.get(key) ?? [];
    list.push(name);
    groups.set(key, list);
  }
  return {
    ok: true,
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, names]) => ({ title, names })),
  };
}

/** The cards' data: one part per capture group, else the data itself. */
export function dataParts(data: CardData, metrics: readonly MetricInfo[]): Array<{ data: PanelData; title?: string }> {
  if (data.mode !== "groups") return [{ data }];
  const r = captureGroups(data.regex, metrics);
  return r.ok ? r.groups.map((g) => ({ data: { mode: "series", names: g.names }, title: g.title })) : [];
}

/** The metrics of the bound runs the data resolves to (every group's, for groups). */
export function dataMetrics(data: CardData, metrics: readonly MetricInfo[]): MetricInfo[] {
  if (data.mode === "runs") return [];
  if (data.mode === "groups") {
    const names = new Set(dataParts(data, metrics).flatMap((p) => (p.data.mode === "series" ? p.data.names : [])));
    return metrics.filter((m) => names.has(m.name));
  }
  if (data.mode === "regex") {
    const r = regexMatches(data.regex, metrics);
    return r.ok ? r.matches : [];
  }
  const byName = new Map(metrics.map((m) => [m.name, m]));
  return data.names.map((n) => byName.get(n)).filter((m): m is MetricInfo => m != null);
}

/** Whether there is anything picked (for groups: at least one group). */
export function dataReady(data: CardData, metrics: readonly MetricInfo[]): boolean {
  if (data.mode === "runs") return true;
  if (data.mode === "groups") return dataParts(data, metrics).length > 0;
  if (data.mode === "regex") return compileSelectorRegex(data.regex.trim()) != null && data.regex.trim() !== "";
  return data.names.length > 0;
}

export function sameData(a: CardData, b: CardData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A short description of the data: `loss`, `loss + 2 more`, `/val\..*\/`, `whole runs`, `/(.*)\.loss/ → 3 cards`. */
export function dataLabel(data: CardData, metrics: readonly MetricInfo[]): string {
  if (data.mode === "runs") return "whole runs";
  if (data.mode === "regex") return `/${data.regex}/`;
  if (data.mode === "groups") {
    const n = dataParts(data, metrics).length;
    return `/${data.regex}/ → ${n} card${n === 1 ? "" : "s"}`;
  }
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
  /** Unique among the options: the card type, or `custom:<viewer>` for one custom viewer. */
  key: string;
  type: CardType;
  /** Settings the option seeds a new card with (a custom viewer's `viewer`). */
  seed?: Record<string, unknown>;
  /** A custom viewer's icon (Font Awesome solid name). */
  icon?: string;
  label: string;
  hint: string;
  /** Why it cannot be added now (too few runs, too many series), else null. */
  unavailable: string | null;
}

/** Per-metric card types that draw one series only. */
const SINGLE_SERIES = new Set<string>(["histogram", "text", "artifact"]);
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
  ["parallel", 1, 1],
  ["importance", 1, 1],
];
/** Cards without series: they compare whole runs. */
const RUN_TYPES: CardType[] = ["scalars", "config", "run-compare", "code-diff", "parallel", "scatter", "bar", "tile", "importance"];

export interface CompatResult {
  options: TypeOption[];
  /** Why nothing fits (mixed kinds, nothing picked), else null. */
  reason: string | null;
}

/**
 * The option a card is: `custom:<viewer>` for a card pinned to a viewer (a
 * custom card naming its viewer, or a built-in type a viewer can show), else
 * its type (`custom`: the data's default viewer).
 */
export function optionKey(type: CardType, settings: Record<string, unknown>): string {
  const pinned = typeof settings.viewer === "string" && (type === "custom" || VIEWER_DEFAULT_TYPES.has(type));
  return pinned ? `custom:${settings.viewer}` : type;
}

/** An option key's card type and the settings it seeds. */
export function parseOptionKey(key: string): { type: CardType; seed: Record<string, unknown> } {
  return key.startsWith("custom:") ? { type: "custom", seed: { viewer: key.slice("custom:".length) } } : { type: key as CardType, seed: {} };
}

/** A card's label in the builder: its type, or its custom viewer's title. */
export function optionLabel(key: string, viewers: readonly ViewerInfo[] = []): string {
  const { type, seed } = parseOptionKey(key);
  if (type !== "custom" || typeof seed.viewer !== "string") return builderTypeLabel(type);
  const v = viewers.find((x) => x.name === seed.viewer);
  return v?.title || seed.viewer;
}

/**
 * The card types that can show `data` for `runCount` bound runs, plus every
 * custom viewer of `viewers` that accepts all of the data (custom data by
 * kind, or a built-in kind it takes over), as `custom:<name>` options.
 * `keepKey` (the option of a card being edited, see `optionKey`) is always offered.
 * For groups: the options every group's card can take (an option
 * unavailable for one group is unavailable, with that group's reason).
 */
export function compatibleTypes(
  data: CardData,
  metrics: readonly MetricInfo[],
  runCount: number,
  keepKey: string | null = null,
  viewers: readonly ViewerInfo[] = [],
  defaults: ViewerDefaults | null = null,
): CompatResult {
  if (data.mode !== "groups") return panelCompatibleTypes(data, metrics, runCount, keepKey, viewers, defaults);
  const parts = dataParts(data, metrics);
  if (parts.length === 0) {
    const r = captureGroups(data.regex, metrics);
    return { options: [], reason: r.ok ? "No series of these runs matches (yet)." : r.error };
  }
  const results = parts.map((p) => panelCompatibleTypes(p.data, metrics, runCount, null, viewers, defaults));
  const options: TypeOption[] = [];
  for (const o of results[0]!.options) {
    const each = results.map((r) => r.options.find((x) => x.key === o.key));
    if (each.some((x) => x == null)) continue;
    const unavailable = each.map((x) => x!.unavailable).find((u) => u != null) ?? null;
    options.push({ ...o, unavailable });
  }
  const reason = options.length ? null : (results.find((r) => r.reason)?.reason ?? "No card type fits every group.");
  return { options, reason };
}

function panelCompatibleTypes(
  data: PanelData,
  metrics: readonly MetricInfo[],
  runCount: number,
  keepKey: string | null,
  viewers: readonly ViewerInfo[],
  defaults: ViewerDefaults | null,
): CompatResult {
  const runsNote = (t: CardType) => {
    const need = minRunsFor(t);
    return runCount < need ? `needs ${need}+ runs` : null;
  };
  const opt = (type: CardType, unavailable: string | null): TypeOption => ({
    key: type,
    type,
    label: builderTypeLabel(type),
    hint: TYPE_HINTS[type] ?? `The ${builderTypeLabel(type).toLowerCase()} card of this series.`,
    unavailable: unavailable ?? runsNote(type),
  });
  const viewerOpt = (v: ViewerInfo): TypeOption => ({
    key: `custom:${v.name}`,
    type: "custom",
    seed: { viewer: v.name },
    // The server checks the name against its icon list; here only that it is a plain name.
    ...(v.icon && /^[a-z0-9-]+$/.test(v.icon) ? { icon: v.icon } : {}),
    label: v.title || v.name,
    hint: `${v.description ? `${v.description} ` : ""}Custom viewer ${v.name}${v.dev ? " (live dev source)" : v.version != null ? ` v${v.version}` : ""}.`,
    unavailable: v.error ? `the viewer is broken: ${v.error}` : null,
  });
  /** The kind's default viewer (the Defaults page; lib/custom/viewers.ts defaultViewerName). */
  const defaultOf = (series: SeriesKind): ViewerInfo | null => {
    const name = defaultViewerName(defaults, viewers, series);
    return name ? (viewers.find((v) => v.name === name) ?? null) : null;
  };
  /**
   * A built-in type a viewer is the default of shows in that viewer; custom
   * data without a pinned viewer (`custom`) in its kind's default. Either
   * follows the default when it changes.
   */
  const defaultOpt = (type: CardType, series: SeriesKind | null, unavailable: string | null): TypeOption => {
    const d = series ? defaultOf(series) : null;
    if (type === "custom") {
      const title = d ? d.title || d.name : null;
      return {
        key: "custom",
        type,
        label: title ? `Default (${title})` : "Default viewer",
        hint: `The default viewer of this data (the Defaults page)${title ? `, now ${title}` : ""}: the card follows it.`,
        unavailable,
      };
    }
    const o = opt(type, unavailable);
    if (!d) return o;
    return {
      ...o,
      label: `${o.label} (default: ${d.title || d.name})`,
      hint: `Shown by its default viewer, ${d.title || d.name} (the Defaults page): the card follows that default.`,
    };
  };
  const keepOpt = (key: string): TypeOption => {
    const { type, seed } = parseOptionKey(key);
    if (type === "custom" && typeof seed.viewer === "string") {
      const v = viewers.find((x) => x.name === seed.viewer);
      return v ? viewerOpt(v) : { key, type, seed, label: seed.viewer, hint: `Custom viewer ${seed.viewer}.`, unavailable: null };
    }
    return type === "custom" ? defaultOpt(type, null, null) : opt(type, null);
  };
  const withKeep = (r: CompatResult): CompatResult =>
    keepKey && !r.options.some((o) => o.key === keepKey) ? { ...r, options: [keepOpt(keepKey), ...r.options] } : r;

  if (data.mode === "runs") return withKeep({ options: RUN_TYPES.map((t) => opt(t, null)), reason: null });
  if (!dataReady(data, metrics)) return withKeep({ options: [], reason: "Pick the data first." });

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
  const first: SeriesKind = { object_type: kind, kind: resolved[0]!.kind ?? null };
  if (SERIES_TYPES.has(kind)) {
    const type = kind as CardType;
    const note = SINGLE_SERIES.has(kind) && count > 1 ? "shows one series" : null;
    options.push(VIEWER_DEFAULT_TYPES.has(kind) ? defaultOpt(type, first, note) : opt(type, note));
  }
  if (kind === "scalar" && data.mode === "series") {
    for (const [type, lo, hi] of SCALAR_MULTI_RUN) {
      const n = count < lo || count > hi ? (hi === 1 ? "shows one series" : `takes ${lo}–${hi} series`) : null;
      options.push(opt(type, n));
    }
  }
  if (kind !== "scalar") {
    const matching = viewersFor(viewers, resolved.map((m) => ({ object_type: m.object_type, kind: m.kind ?? null })));
    if (kind === "custom" && matching.length > 0) options.push(defaultOpt("custom", first, null));
    options.push(...matching.map(viewerOpt));
  }
  const custom = kind === "custom" ? ` No custom viewer accepts ${[...new Set(resolved.map((m) => m.kind ?? "?"))].join(", ")} yet: publish one with \`cairn viewer publish\`.` : "";
  return withKeep({ options, reason: options.length ? null : `No card shows ${kind} series.${custom}` });
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
      return { metric: lastOf(names[0]!) };
    case "importance":
    case "parallel":
      return { metric: names[0]! };
    case "scatter":
      return names.length >= 2 ? { x: lastOf(names[0]!), y: lastOf(names[1]!) } : { y: lastOf(names[0]!) };
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
  data: PanelData,
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
export function defaultTitle(type: CardType, data: PanelData): string {
  if (!isMultiRunCardType(type) || data.mode !== "series" || data.names.length === 0) return "";
  return `${data.names.join(", ")} · ${builderTypeLabel(type)}`;
}

/** A card the editor adds (the panel id comes on writing). */
export interface NewCard {
  type: CardType;
  selector: MetricSelector;
  settings: Record<string, unknown>;
}

/**
 * The cards for the data and the chosen options (card types, or
 * `custom:<viewer>`): one per option, times one per group. A group's card
 * is titled by its captures; a multi-run card by its data (`loss · Value`).
 */
export function newCards(data: CardData, optionKeys: readonly string[], metrics: readonly MetricInfo[]): NewCard[] {
  const out: NewCard[] = [];
  for (const part of dataParts(data, metrics)) {
    for (const key of optionKeys) {
      const { type, seed } = parseOptionKey(key);
      const title = part.title ?? defaultTitle(type, part.data);
      const seeded = seedPanel(type, part.data, { ...(title ? { title } : {}), ...seed });
      out.push({ type, selector: seeded.selector, settings: seeded.settings });
    }
  }
  return out;
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
    const kind = summaryTypeOfName(name) ?? m?.object_type ?? "scalar";
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

// ---------------------------------------------------------------------------
// Editing a card in place (the gear's editor)
// ---------------------------------------------------------------------------

/** Settings a type change keeps (the card's frame, not its content). */
export const FRAME_KEYS = ["title", "height", "width", "collapsed"] as const;

const pickKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));

/** A title that is still its card's default (`loss · Value`) follows the data; one the user wrote stays. */
export function followTitle(type: CardType, settings: Record<string, unknown>, data: PanelData): Record<string, unknown> {
  const was = defaultTitle(type, panelData({ type, selector: { names: [] }, settings }));
  if (!was || settings.title !== was) return settings;
  const next = { ...settings };
  const now = defaultTitle(type, data);
  if (now) next.title = now;
  else delete next.title;
  return next;
}

/** What the gear's editor changes on a card: its data, its type (an option key), its title. */
export interface PanelChange {
  data?: PanelData;
  /** A card type, or `custom:<viewer>` (see optionKey). */
  option?: string;
  /** "" clears the title (the card is named by its data again). */
  title?: string;
}

/**
 * The card after an edit. A new type keeps the card's frame (title, size)
 * and starts its own settings; another viewer of the same type — or its
 * default viewer again — keeps the card's settings (each viewer's are stored
 * apart) but not a pinned version. New data keeps the settings (a default
 * title follows the data).
 */
export function changedPanel(
  panel: Pick<Panel, "type" | "selector" | "settings">,
  change: PanelChange,
): Pick<Panel, "type" | "selector" | "settings"> {
  const data = change.data ?? panelData(panel);
  let type = panel.type;
  let settings: Record<string, unknown> = panel.settings;
  if (change.option && change.option !== optionKey(panel.type, panel.settings)) {
    const next = parseOptionKey(change.option);
    if (next.type === panel.type) {
      settings = { ...panel.settings, ...next.seed };
      if (next.seed.viewer == null) delete settings.viewer;
      delete settings.viewer_version;
    } else {
      const frame = pickKeys(panel.settings, FRAME_KEYS);
      const prevDefault = defaultTitle(panel.type, panelData({ type: panel.type, selector: { names: [] }, settings: panel.settings }));
      if (prevDefault && frame.title === prevDefault) delete frame.title;
      const title = defaultTitle(next.type, data);
      if (frame.title == null && title) frame.title = title;
      settings = { ...frame, ...next.seed };
    }
    type = next.type;
  } else if (change.data) {
    settings = followTitle(type, settings, data);
  }
  const seeded = seedPanel(type, data, settings);
  if (change.title !== undefined) {
    seeded.settings = { ...seeded.settings };
    if (change.title.trim()) seeded.settings.title = change.title.trim();
    else delete seeded.settings.title;
  }
  return { type, selector: seeded.selector, settings: seeded.settings };
}
