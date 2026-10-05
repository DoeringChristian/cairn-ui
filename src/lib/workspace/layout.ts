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
 *   in an automatic section after the doc's sections. Off: none.
 * - A hidden panel (`panel.hidden`) still claims its metric but renders
 *   nowhere.
 * - Hide patterns and the search query filter the rendered panels by label.
 */

import { isMultiRunCardType, MULTI_RUN_CARD_LABELS } from "../comparisons/types.ts";
import type { CardType } from "../cards/card-spec.ts";
import { autoSectionOf, compareAutoSections } from "../sections.ts";
import { AUTO_PREFIX, autoPanelId, claimedMetric, isAutoPanelId, ops, type Panel, type WorkspaceDoc, type WorkspaceOp } from "./doc.ts";
import { compilePanelFilter } from "./panel-filter.ts";

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
  for (const m of doc.autoPanels ? [...metrics].sort((a, b) => a.name.localeCompare(b.name)) : []) {
    if (claimed.has(m.name) || removed.has(m.name)) continue;
    const s = autoSectionOf(m.name, m.object_type);
    const list = autoBuckets.get(s) ?? [];
    list.push(m);
    autoBuckets.set(s, list);
  }

  const render = (panel: Panel, auto: boolean, section: string): RenderedPanel => ({
    panel,
    auto,
    section,
    metrics: resolvePanelMetrics(panel, byName),
    label: panelLabel(panel),
  });
  const finish = (panels: RenderedPanel[], sort: boolean) => {
    const shown = panels.filter((p) => visible(p.label));
    return sort ? shown.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) : shown;
  };

  const out: RenderedSection[] = [];
  for (const s of doc.sections) {
    const own = s.panels.filter((p) => !p.hidden).map((p) => render(p, false, s.name));
    const autos = (autoBuckets.get(s.name) ?? []).map((m) => render(autoPanel(m), true, s.name));
    autoBuckets.delete(s.name);
    out.push({ name: s.name, inDoc: true, collapsed: s.collapsed, sort: s.sort, panels: finish([...own, ...autos], s.sort) });
  }
  for (const name of [...autoBuckets.keys()].sort(compareAutoSections)) {
    const autos = autoBuckets.get(name)!.map((m) => render(autoPanel(m), true, name));
    const panels = finish(autos, false);
    if (panels.length > 0) out.push({ name, inDoc: false, collapsed: false, sort: false, panels });
  }
  return out;
}

/**
 * The panels to write when an automatic panel of section `section` is
 * touched: every automatic panel rendered before it in that section, and
 * itself, so materializing never changes the order on screen.
 */
export function panelsToMaterialize(sections: readonly RenderedSection[], panelId: string): { section: string; panels: Panel[] } | null {
  for (const s of sections) {
    const at = s.panels.findIndex((p) => p.panel.id === panelId);
    if (at < 0) continue;
    if (!s.panels[at]!.auto) return { section: s.name, panels: [] };
    return { section: s.name, panels: s.panels.slice(0, at + 1).filter((p) => p.auto).map((p) => p.panel) };
  }
  return null;
}

/** Every automatic panel of a section, in rendered order (materializing a whole section). */
export function sectionAutoPanels(sections: readonly RenderedSection[], name: string): Panel[] {
  return sections.find((s) => s.name === name)?.panels.filter((p) => p.auto).map((p) => p.panel) ?? [];
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
