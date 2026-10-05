/**
 * Adding cards to a workspace (pure): what the add panel
 * (components/workspace/AddCardsPanel.tsx) offers and writes. The panel
 * opens at a + of the layout — a section header's, the dashed tile ending a
 * section's grid — and the cards land in that section.
 *
 * The data is the card builder's (lib/workspace/card-builder.ts: series,
 * an anchored regex, whole runs) plus **groups**: a regex whose capture
 * groups split the matches into one card each. Metrics whose captures
 * agree share a card, so `(train|val)\.loss` makes one card per split and
 * `.*\.(loss|acc)` puts `train.loss` and `val.loss` on one card and the two
 * accuracies on another; without capture groups every match lands on one
 * card. Each group's card lists its metrics by name, titled by its
 * captures joined by " · ".
 */

import type { ViewerInfo } from "../../api/types.ts";
import type { CardType } from "../cards/card-spec.ts";
import {
  compatibleTypes,
  dataLabel,
  dataMetrics,
  dataReady,
  defaultTitle,
  parseOptionKey,
  seedPanel,
  type BuilderData,
  type CompatResult,
  type TypeOption,
} from "./card-builder.ts";
import { ops, type MetricSelector, type Panel, type WorkspaceOp } from "./doc.ts";
import { compileSelectorRegex, sectionAutoPanels, type MetricInfo, type RenderedSection } from "./layout.ts";

/** What the add panel's data step picks. */
export type AddData = BuilderData | { mode: "groups"; regex: string };

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

/** The cards' data: one part per card group, else the data itself. */
export function addDataParts(data: AddData, metrics: readonly MetricInfo[]): Array<{ data: BuilderData; title?: string }> {
  if (data.mode !== "groups") return [{ data }];
  const r = captureGroups(data.regex, metrics);
  return r.ok ? r.groups.map((g) => ({ data: { mode: "series", names: g.names }, title: g.title })) : [];
}

/** Whether there is anything to add. */
export function addDataReady(data: AddData, metrics: readonly MetricInfo[]): boolean {
  return data.mode === "groups" ? addDataParts(data, metrics).length > 0 : dataReady(data);
}

/** `loss`, `/val\..*\/`, `whole runs`, `/(.*)\.loss/ → 3 cards`. */
export function addDataLabel(data: AddData, metrics: readonly MetricInfo[]): string {
  if (data.mode !== "groups") return dataLabel(data);
  const n = addDataParts(data, metrics).length;
  return `/${data.regex}/ → ${n} card${n === 1 ? "" : "s"}`;
}

/** The series the data resolves to (every group's, for groups). */
export function addDataMetrics(data: AddData, metrics: readonly MetricInfo[]): MetricInfo[] {
  if (data.mode !== "groups") return dataMetrics(data, metrics);
  const names = new Set(addDataParts(data, metrics).flatMap((p) => (p.data.mode === "series" ? p.data.names : [])));
  return metrics.filter((m) => names.has(m.name));
}

/**
 * The card types for the data. For groups: the options every group's card
 * can take (an option unavailable for one group is unavailable, with that
 * group's reason).
 */
export function addCompatibleTypes(
  data: AddData,
  metrics: readonly MetricInfo[],
  runCount: number,
  viewers: readonly ViewerInfo[] = [],
): CompatResult {
  if (data.mode !== "groups") return compatibleTypes(data, metrics, runCount, null, viewers);
  const parts = addDataParts(data, metrics);
  if (parts.length === 0) {
    const r = captureGroups(data.regex, metrics);
    return { options: [], reason: r.ok ? "No series of these runs matches (yet)." : r.error };
  }
  const results = parts.map((p) => compatibleTypes(p.data, metrics, runCount, null, viewers));
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

/** A card the add panel writes (the panel id comes on writing). */
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
export function newCards(data: AddData, optionKeys: readonly string[], metrics: readonly MetricInfo[]): NewCard[] {
  const out: NewCard[] = [];
  for (const part of addDataParts(data, metrics)) {
    for (const key of optionKeys) {
      const { type, seed } = parseOptionKey(key);
      const title = part.title ?? defaultTitle(type, part.data);
      const seeded = seedPanel(type, part.data, { ...(title ? { title } : {}), ...seed });
      out.push({ type, selector: seeded.selector, settings: seeded.settings });
    }
  }
  return out;
}

/** `base`, else `base 2`, `base 3`, … — the first not in `taken`. */
export function uniqueSectionName(base: string, taken: readonly string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Add `panels` at the end of section `name` as rendered (`sections`, a
 * `deriveLayout` result): every rendered section gets its place in the
 * document, and the section's automatic panels are written first, so the
 * new cards come after them, where the + was.
 */
export function addToSectionOp(sections: readonly RenderedSection[], name: string, panels: readonly Panel[]): WorkspaceOp {
  return ops.seq(
    ops.ensureSections(sections.map((s) => s.name)),
    ops.addPanels(name, sectionAutoPanels(sections, name)),
    ops.addPanels(name, panels),
  );
}
