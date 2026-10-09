/**
 * What a workspace renders (pure): its document's sections and panels plus
 * the automatic panels for every metric of the bound runs that no panel
 * stands in for.
 *
 * - A doc panel's metrics resolve against the bound runs: listed `names`,
 *   or a `regex` matched against the whole name. None logged → the panel
 *   renders an empty state, so the layout holds still while flipping runs.
 * - A metric is claimed by a panel whose selector names exactly that metric
 *   (`claimedMetric`). Multi-metric and regex panels are extra views.
 * - While `autoPanels` is on, every unclaimed metric that is not in
 *   `removed` gets an automatic panel `auto:<name>`, in the doc section
 *   named by the automatic rule (lib/sections.ts) after its own panels, or
 *   in an automatic section after the doc's sections (the Summary section
 *   before them). Off: none.
 * - A scalar logged at a single step gets no automatic panel: the Summary
 *   section's Scalars card shows it. The Summary cards stand in for the
 *   pseudo-series `@scalars` / `@config` (lib/workspace/summary-cards.ts),
 *   which the caller adds to `metrics` for the runs that have data; a
 *   Scalars / Config panel shows its pseudo-series whatever its selector.
 * - A hidden panel (`panel.hidden`) still claims its metric but renders
 *   nowhere.
 * - Automatic panels of a document section keep their A–Z place among its
 *   materialized automatic panels (`auto:` ids): touching one writes only
 *   that one (`materializeOp`) and the page does not move.
 * - Hide patterns and the search query filter the rendered panels by label.
 */

import { isMultiRunCardType, MULTI_RUN_CARD_LABELS } from "../comparisons/types.ts";
import type { CardType } from "../cards/card-spec.ts";
import { autoSectionOf, compareAutoSections } from "../sections.ts";
import { AUTO_PREFIX, autoPanelId, claimedMetric, isAutoPanelId, ops, type Panel, type WorkspaceDoc, type WorkspaceOp } from "./doc.ts";
import { compilePanelFilter } from "./panel-filter.ts";
import { compareAutoNames, isSingleStepScalar, isSummaryCardType, SUMMARY_SECTION, summaryNameOf, summaryTypeOfName } from "./summary-cards.ts";

/** One metric across the bound runs. */
export interface MetricInfo {
  name: string;
  object_type: string;
  /** Points logged (the max over runs). */
  count: number;
  /** Bound runs that log it. */
  runIds: string[];
  /** Custom data: its kind (`guiding/vmf`), for matching custom viewers. */
  kind?: string | null;
}

export interface RenderedPanel {
  panel: Panel;
  /** Not in the document (yet): an automatic panel. */
  auto: boolean;
  section: string;
  /** Resolved metrics the bound runs log, in selector order (regex: A–Z). */
  metrics: MetricInfo[];
  /** Title, else what it shows. Search and hide patterns match this. */
  label: string;
}

export interface RenderedSection {
  name: string;
  /** The section is in the document. */
  inDoc: boolean;
  collapsed: boolean;
  sort: boolean;
  panels: RenderedPanel[];
  /** The run page (`withoutEmptyPanels`): the section's cards hidden for showing nothing the run logs. */
  hiddenCards?: number;
}

/** Anchored, case-sensitive: metric names are identifiers. Null for an invalid regex. */
export function compileSelectorRegex(re: string): RegExp | null {
  try {
    return new RegExp(`^(?:${re})$`);
  } catch {
    return null;
  }
}

/** The metrics a panel shows among `byName`. */
export function resolvePanelMetrics(panel: Pick<Panel, "selector">, byName: ReadonlyMap<string, MetricInfo>): MetricInfo[] {
  if ("regex" in panel.selector) {
    const re = compileSelectorRegex(panel.selector.regex);
    if (!re) return [];
    return [...byName.values()].filter((m) => re.test(m.name)).sort((a, b) => a.name.localeCompare(b.name));
  }
  return panel.selector.names.map((n) => byName.get(n)).filter((m): m is MetricInfo => m != null);
}

/** A panel's display label: its title, or the metric(s) it shows. */
export function panelLabel(panel: Panel): string {
  const title = panel.settings.title;
  if (typeof title === "string" && title) return title;
  if (isMultiRunCardType(panel.type)) return MULTI_RUN_CARD_LABELS[panel.type];
  if ("regex" in panel.selector) return `/${panel.selector.regex}/`;
  return panel.selector.names.join(", ") || panel.type;
}

/**
 * What removing a panel records in `removed` so its automatic panel does not
 * come back: a Summary card's pseudo-series (it keeps its `auto:` id), else
 * the metric the panel stands in for (`claimedMetric`).
 */
export function claimedName(panel: Pick<Panel, "id" | "selector">): string | null {
  if (isAutoPanelId(panel.id) && summaryTypeOfName(panel.id.slice(AUTO_PREFIX.length))) return panel.id.slice(AUTO_PREFIX.length);
  return claimedMetric(panel);
}

/** The automatic panel for a metric. */
export function autoPanel(m: MetricInfo): Panel {
  return { id: autoPanelId(m.name), type: m.object_type as CardType, selector: { names: [m.name] }, settings: {} };
}

export interface DeriveOptions {
  /** The search box (panel-filter syntax). */
  query?: string;
  /** Apply the document's hide patterns (default true). */
  hidePatterns?: boolean;
}

export function deriveLayout(doc: WorkspaceDoc, metrics: readonly MetricInfo[], opts: DeriveOptions = {}): RenderedSection[] {
  const byName = new Map(metrics.map((m) => [m.name, m]));
  const search = compilePanelFilter(opts.query ?? "");
  const hide = opts.hidePatterns === false ? [] : doc.hidePatterns.map(compilePanelFilter).filter((f) => f.query !== "");
  const visible = (label: string) => !hide.some((f) => f.test(label)) && search.test(label);

  const claimed = new Set<string>();
  for (const s of doc.sections) for (const p of s.panels) {
    const m = claimedMetric(p);
    if (m != null) claimed.add(m);
    // A materialized automatic panel keeps its id even after its metrics change.
    if (isAutoPanelId(p.id)) claimed.add(p.id.slice(AUTO_PREFIX.length));
  }
  const removed = new Set(doc.removed);

  // Automatic panels, bucketed by their automatic section.
  const autoBuckets = new Map<string, MetricInfo[]>();
  for (const m of doc.autoPanels ? [...metrics].sort((a, b) => compareAutoNames(a.name, b.name)) : []) {
    if (claimed.has(m.name) || removed.has(m.name) || isSingleStepScalar(m)) continue;
    const s = autoSectionOf(m.name, m.object_type);
    const list = autoBuckets.get(s) ?? [];
    list.push(m);
    autoBuckets.set(s, list);
  }

  const render = (panel: Panel, auto: boolean, section: string): RenderedPanel => ({
    panel,
    auto,
    section,
    metrics: isSummaryCardType(panel.type)
      ? [byName.get(summaryNameOf(panel.type))].filter((m): m is MetricInfo => m != null)
      : resolvePanelMetrics(panel, byName),
    label: panelLabel(panel),
  });
  const finish = (panels: RenderedPanel[], sort: boolean) => {
    const shown = panels.filter((p) => visible(p.label));
    return sort ? shown.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) : shown;
  };

  const out: RenderedSection[] = [];
  const autoSection = (name: string) => {
    const autos = autoBuckets.get(name)!.map((m) => render(autoPanel(m), true, name));
    const panels = finish(autos, false);
    if (panels.length > 0) out.push({ name, inDoc: false, collapsed: false, sort: false, panels });
  };
  // The Summary section leads the page until it is in the document.
  if (autoBuckets.has(SUMMARY_SECTION) && !doc.sections.some((s) => s.name === SUMMARY_SECTION)) {
    autoSection(SUMMARY_SECTION);
    autoBuckets.delete(SUMMARY_SECTION);
  }
  for (const s of doc.sections) {
    // Automatic panels keep their A–Z place among the section's materialized
    // ones: each goes right before the first `auto:` panel named after it.
    const autos = autoBuckets.get(s.name) ?? [];
    autoBuckets.delete(s.name);
    const panels: RenderedPanel[] = [];
    let next = 0;
    for (const p of s.panels) {
      if (isAutoPanelId(p.id)) {
        const name = p.id.slice(AUTO_PREFIX.length);
        while (next < autos.length && compareAutoNames(autos[next]!.name, name) < 0) panels.push(render(autoPanel(autos[next++]!), true, s.name));
      }
      if (!p.hidden) panels.push(render(p, false, s.name));
    }
    for (const m of autos.slice(next)) panels.push(render(autoPanel(m), true, s.name));
    out.push({ name: s.name, inDoc: true, collapsed: s.collapsed, sort: s.sort, panels: finish(panels, s.sort) });
  }
  for (const name of [...autoBuckets.keys()].sort(compareAutoSections)) autoSection(name);
  return out;
}

/**
 * The op that writes automatic panel `panelId` (as rendered in `sections`, a
 * `deriveLayout` result) into the document so it can be edited — that panel
 * only: it goes before the first materialized `auto:` panel named after it,
 * where `deriveLayout` already shows it, so nothing on screen moves. The
 * sections rendered up to its own get their place in the document first.
 * Identity for a panel already in the document (or not rendered).
 */
export function materializeOp(sections: readonly RenderedSection[], panelId: string): WorkspaceOp {
  const at = sections.findIndex((s) => s.panels.some((p) => p.panel.id === panelId && p.auto));
  if (at < 0) return (d) => d;
  const section = sections[at]!.name;
  const panel = sections[at]!.panels.find((p) => p.panel.id === panelId)!.panel;
  const name = panelId.slice(AUTO_PREFIX.length);
  return ops.seq(ops.ensureSections(sections.slice(0, at + 1).map((s) => s.name)), (d) => {
    const s = d.sections.find((x) => x.name === section);
    const before = s?.panels.find((p) => isAutoPanelId(p.id) && compareAutoNames(p.id.slice(AUTO_PREFIX.length), name) > 0);
    const index = before ? s!.panels.indexOf(before) : null;
    return ops.addPanels(section, [panel], index)(d);
  });
}

/** Every automatic panel of a section, in rendered order (materializing a whole section). */
export function sectionAutoPanels(sections: readonly RenderedSection[], name: string): Panel[] {
  return sections.find((s) => s.name === name)?.panels.filter((p) => p.auto).map((p) => p.panel) ?? [];
}

/**
 * Add `panels` at the end of section `name` as rendered (`sections`, a
 * `deriveLayout` result): every rendered section gets its place in the
 * document, and the section's automatic panels are written first, so the
 * new cards come after them, where the ghost card was.
 */
export function addToSectionOp(sections: readonly RenderedSection[], name: string, panels: readonly Panel[]): WorkspaceOp {
  return ops.seq(
    ops.ensureSections(sections.map((s) => s.name)),
    ops.addPanels(name, sectionAutoPanels(sections, name)),
    ops.addPanels(name, panels),
  );
}

/**
 * The run page's layout (as wandb's run page): a panel that shows no metric
 * the run logs renders nowhere. Multi-run cards select no metric and stay,
 * except the Summary cards: they show while the run has scalars / summary
 * values or config (their pseudo-series). The order is untouched.
 *
 * A section with no cards at all (a new one) always stays, with its
 * add-card entry. With `noteHidden` (the Workspace tab), a section whose
 * cards are all hidden stays too, and `hiddenCards` counts its cards hidden
 * for lack of data; without it (the System tab, a slice of the same view)
 * such a section is not shown. A card naming only metrics `metricFilter`
 * leaves to the other tab (the System tab's `system.*`) is not counted.
 */
export function withoutEmptyPanels(
  sections: readonly RenderedSection[],
  opts: { noteHidden?: boolean; metricFilter?: (name: string) => boolean } = {},
): RenderedSection[] {
  const { noteHidden = false, metricFilter } = opts;
  const keep = (p: RenderedPanel) =>
    p.metrics.length > 0 || (isMultiRunCardType(p.panel.type) && !isSummaryCardType(p.panel.type));
  const otherTab = (p: RenderedPanel) =>
    metricFilter !== undefined && "names" in p.panel.selector && p.panel.selector.names.length > 0 && p.panel.selector.names.every((n) => !metricFilter(n));
  const out: RenderedSection[] = [];
  for (const s of sections) {
    const panels = s.panels.filter(keep);
    const hiddenCards = s.panels.filter((p) => !keep(p) && !otherTab(p)).length;
    if (s.panels.length > 0 && panels.length === 0 && (!noteHidden || hiddenCards === 0)) continue;
    out.push({ ...s, panels, hiddenCards: noteHidden ? hiddenCards : 0 });
  }
  return out;
}

/** A section's note for its cards hidden on the run page (`withoutEmptyPanels`), or null. */
export function hiddenCardsNote(section: Pick<RenderedSection, "hiddenCards">): string | null {
  const n = section.hiddenCards ?? 0;
  return n === 0 ? null : `${n} card${n === 1 ? "" : "s"} without data for this run`;
}

/**
 * A section header's card count: `N card(s)`, or `k of N shown` when the run page hides
 * `hidden` of its cards for lack of data (`0 of 3 shown` when it hides them all).
 * Collapsed: `N card(s) hidden`, N counting every card of the section.
 */
export function sectionCountLabel(shown: number, hidden: number, collapsed: boolean): string {
  const total = shown + hidden;
  if (collapsed) return `${total} card(s) hidden`;
  return hidden > 0 ? `${shown} of ${total} shown` : `${total} card(s)`;
}

/** `base`, else `base 2`, `base 3`, … — the first not in `taken`. */
export function uniqueSectionName(base: string, taken: readonly string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Write every automatic panel of `sections` (a `deriveLayout` result) into
 * the document, in rendered order, giving every rendered section its place.
 */
export function materializeAllOp(sections: readonly RenderedSection[]): WorkspaceOp {
  return ops.seq(
    ops.ensureSections(sections.map((s) => s.name)),
    ...sections.map((s) => ops.addPanels(s.name, s.panels.filter((p) => p.auto).map((p) => p.panel))),
  );
}

/**
 * Turn "include unlisted metrics" on or off. Off first materializes the
 * automatic panels `sections` shows (the unsearched layout): nothing on
 * screen disappears. Metrics logged afterwards — and those a hide pattern
 * hides at that moment — stay out until added.
 */
export function autoPanelsOp(on: boolean, sections: readonly RenderedSection[]): WorkspaceOp {
  return on ? ops.setAutoPanels(true) : ops.seq(materializeAllOp(sections), ops.setAutoPanels(false));
}

export { isAutoPanelId };
