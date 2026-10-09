/**
 * The ```cairn dialect: a declarative YAML card spec that compiles 1:1 to a
 * `CardsBlock`. This is a pure parser — no `eval`, no JS execution, no
 * sandbox. A malformed spec throws `CairnBlockError`; the markdown⇄blocks
 * bridge catches it and emits an inline error instead of crashing the report.
 *
 * Grammar:
 *
 *   runSets:                                  # 1..n run sets (lib/run-sets.ts)
 *     - name: Baselines
 *       filter: { kind: group, op: and, children: [{ kind: chip, field: group, op: exact, arg: exp-44 }] }
 *       groupBy: [{ source: job_type }]
 *       latestOnly: true
 *       sort: [{ column: created_at, direction: desc }]
 *       eyes: { "r:3f9c…": false }
 *   view: { hidden: [run_def], pinned: [run_abc], baseline: run_abc }   # optional run view
 *   title: "Validation metrics"                # optional
 *   cards:
 *     - metric: train/loss                     # series card
 *       type: scalar                           # optional if unambiguous
 *       settings: { yScale: log }               # → card-settings store
 *     - type: parallel                          # multi-run card (no `metric`)
 *     - type: scalar                             # manual-series (explicit overlay)
 *       series: [{ runId: run_a, name: loss }]
 *
 * Each run set is the workspace's runs table state, frozen (its filter tree,
 * group-by, latest versions only, sort and eyes); its runs are resolved live
 * (`resolveRunSets`), and the cards draw the union of the sets' runs. A fence
 * with the old `runs:` key (static ids or a selector) is not read at all
 * (`CairnLegacyRunsError`): no migration.
 *
 * Field → existing-model mapping:
 *   runSets              → CardsBlock.runSets (parseRunSet; lenient per field)
 *   view.hidden/pinned/baseline → CardsBlock.runView (lib/run-view.tsx)
 *   cards[].metric+.type → cardFromSpec({kind:"series", ...})
 *   cards[].type (multi-run, no metric/series) → cardFromSpec({kind:"multi-run", ...})
 *   cards[].series       → cardFromSpec({kind:"manual-series", ...})
 *   cards[].settings     → returned `settings` map (cardId → settings), the
 *                          caller writes it via saveCardOverrides/cardSettingsKeyForReport.
 */

import { parse as parseYamlDoc, stringify as stringifyYamlDoc } from "yaml";
import {
  isMultiRunCardType,
  MULTI_RUN_CARD_LABELS,
  MULTI_RUN_CARD_TYPES,
  type ComparisonCard,
  type ComparisonSeriesRef,
  type MultiRunCardType,
} from "../comparisons/types.ts";
import { parseRunSet, type RunSet } from "../run-sets.ts";
import { cardFromSpec, type AddCardSelection } from "./card-from-spec.ts";
import { newId } from "./ids.ts";
import type { MetricIndex } from "./metric-index";
import type { CardsBlock } from "./types";
import type { RunView } from "../run-view.tsx";

export class CairnBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CairnBlockError";
  }
}

/**
 * A fence in the format before run sets (`runs: {ids | selector}`): not
 * read, the cell shows it empty with a notice (no migration).
 */
export class CairnLegacyRunsError extends CairnBlockError {
  constructor() {
    super("This cell uses the old `runs:` format (fixed run ids or a run selector), which is no longer read. Its fence is kept as written until you edit the cell; give it a run set to show runs again.");
    this.name = "CairnLegacyRunsError";
  }
}

interface CairnViewInput {
  /** The cell's run view: runs hidden from its charts, pinned first, and the baseline. */
  hidden?: unknown;
  pinned?: unknown;
  baseline?: unknown;
}

interface CairnCardInput {
  /**
   * Optional stable id — same idea as `CairnSpec.id`
   * for the block: when present, `compileCairnBlock` uses it verbatim as the
   * card's id instead of deriving one, so a settings key
   * (`cardSettingsKeyForReport`/`cardSettingsKeyForScope`, both keyed on
   * `card.id`) never orphans across an edit that changes the card's shape.
   * `serializeCairnSpec` always writes this back out, so once a card has
   * been compiled once, its id survives edit→serialize→reparse round trips
   * verbatim rather than being re-derived.
   */
  id?: unknown;
  metric?: unknown;
  type?: unknown;
  settings?: unknown;
  series?: unknown;
}

/** The parsed (but not yet compiled) YAML document. */
export interface CairnSpec {
  /**
   * Optional block-id carry-through, used by the markdown⇄blocks serializer
   * (lib/reports/markdown-source.ts) for id stability across a cells⇄markdown
   * toggle. Not meaningful for hand/AI-authored specs — omit it; a fresh id
   * is assigned. (Prose `MarkdownBlock`s have no equivalent hidden channel
   * under the no-raw-HTML sanitization contract, so their ids always
   * regenerate on parse — see markdown-source.ts's module doc.)
   */
  id?: string;
  runSets?: unknown[];
  view?: CairnViewInput;
  title?: string;
  cards?: CairnCardInput[];
}

export interface CompiledCairnBlock {
  block: CardsBlock;
  /** cardId → inline settings overrides, to be written via saveCardOverrides. */
  settings: Record<string, unknown>;
}

/** Parse a ```cairn fence body into a validated spec. Never returns partial/undefined shapes silently — throws CairnBlockError with a message a human (or AI) can act on. */
export function parseCairnSpec(source: string): CairnSpec {
  let doc: unknown;
  try {
    doc = parseYamlDoc(source);
  } catch (e) {
    throw new CairnBlockError(`YAML parse error: ${(e as Error).message}`);
  }
  if (doc == null) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new CairnBlockError("a ```cairn block must be a YAML mapping with `runSets`/`view`/`title`/`cards` keys");
  }
  const d = doc as Record<string, unknown>;
  if (d.id !== undefined && typeof d.id !== "string") {
    throw new CairnBlockError("`id` must be a string");
  }
  if (d.title !== undefined && typeof d.title !== "string") {
    throw new CairnBlockError("`title` must be a string");
  }
  if (d.cards !== undefined && !Array.isArray(d.cards)) {
    throw new CairnBlockError("`cards` must be a list");
  }
  if (d.runs !== undefined) throw new CairnLegacyRunsError();
  if (d.runSets !== undefined && !Array.isArray(d.runSets)) {
    throw new CairnBlockError("`runSets` must be a list of run sets");
  }
  if (d.view !== undefined && (typeof d.view !== "object" || d.view === null || Array.isArray(d.view))) {
    throw new CairnBlockError("`view` must be a mapping (`hidden`, `pinned`, `baseline`)");
  }
  return d as CairnSpec;
}

/** The cell's run sets (`runSets`); each entry must be a mapping, its fields are read leniently. */
export function resolveRunSetsSpec(spec: CairnSpec): RunSet[] {
  return (spec.runSets ?? []).map((raw, i) => {
    const set = parseRunSet(raw, i);
    if (!set) throw new CairnBlockError(`runSets[${i}] must be a mapping`);
    return set;
  });
}

/** The cell's run view from `view.hidden`/`pinned`/`baseline`; undefined when none is given. */
export function resolveRunView(spec: CairnSpec): RunView | undefined {
  const view = spec.view;
  if (!view) return undefined;
  const { hidden, pinned, baseline } = view;
  const list = (v: unknown, key: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      throw new CairnBlockError(`view.${key} must be a list of run-id strings`);
    }
    return v as string[];
  };
  const h = list(hidden, "hidden");
  const p = list(pinned, "pinned");
  if (baseline !== undefined && baseline !== null && typeof baseline !== "string") {
    throw new CairnBlockError("view.baseline must be a run-id string");
  }
  const b = typeof baseline === "string" && baseline ? baseline : null;
  if (h.length === 0 && p.length === 0 && b === null) return undefined;
  return { hidden: h, pinned: p, baseline: b };
}

/**
 * The card's own declared shape (metric+type, or its exact manual `series`
 * list) — deliberately NOT derived from any resolved data (metricIndex/
 * runIds), so it's identical across recompiles of the same fence text
 * regardless of an async metric-index load or a selector re-resolution.
 */
function cardShapeKey(c: CairnCardInput): string {
  if (c.series !== undefined) return `series:${JSON.stringify(c.series)}`;
  const metric = typeof c.metric === "string" ? c.metric : "";
  const type = typeof c.type === "string" ? c.type : "";
  return `metric:${metric}|type:${type}`;
}

/**
 * A stable id for a card that had no explicit `id:` in its spec entry —
 * `shape` (see `cardShapeKey`) plus an `occurrence` counter to disambiguate
 * two structurally-identical card entries in the same block (otherwise
 * they'd collide on the same id).
 */
function stableCardId(blockId: string, shape: string, occurrence: number): string {
  return `card:${blockId}:${shape}#${occurrence}`;
}

/** Build one card's AddCardSelection from its spec entry + the block's resolved runIds/metricIndex. */
function selectionForCard(c: CairnCardInput, index: number, metricIndex: MetricIndex, runIds: string[]): AddCardSelection {
  if (c.series !== undefined) {
    if (!Array.isArray(c.series)) throw new CairnBlockError(`cards[${index}].series must be a list`);
    if (typeof c.type !== "string" || c.type.length === 0) {
      throw new CairnBlockError(`cards[${index}]: an explicit \`series\` overlay requires \`type\``);
    }
    const series: ComparisonSeriesRef[] = c.series.map((s, i) => {
      if (typeof s !== "object" || s === null) {
        throw new CairnBlockError(`cards[${index}].series[${i}] must be a mapping`);
      }
      const r = s as Record<string, unknown>;
      if (typeof r.runId !== "string" || typeof r.name !== "string") {
        throw new CairnBlockError(`cards[${index}].series[${i}] must have string \`runId\` and \`name\``);
      }
      return { runId: r.runId, name: r.name };
    });
    return { kind: "manual-series", object_type: c.type, series };
  }

  if (c.metric === undefined) {
    // No metric, no explicit series → a workspace-level multi-run card.
    if (typeof c.type !== "string" || !isMultiRunCardType(c.type)) {
      throw new CairnBlockError(
        `cards[${index}]: specify a \`metric\`, an explicit \`series\`, or a multi-run \`type\` (one of ${MULTI_RUN_CARD_TYPES.join("/")})`,
      );
    }
    const cardType: MultiRunCardType = c.type;
    return {
      kind: "multi-run",
      cardType,
      name: MULTI_RUN_CARD_LABELS[cardType],
      runs: runIds.map((runId) => ({ runId })),
    };
  }

  if (typeof c.metric !== "string" || c.metric.length === 0) {
    throw new CairnBlockError(`cards[${index}].metric must be a non-empty string`);
  }
  const metric = c.metric;

  let objectType: string;
  if (c.type !== undefined) {
    if (typeof c.type !== "string" || c.type.length === 0) {
      throw new CairnBlockError(`cards[${index}].type must be a non-empty string`);
    }
    objectType = c.type;
  } else {
    const matches = Array.from(metricIndex.values()).filter((e) => e.name === metric);
    if (matches.length === 0) {
      throw new CairnBlockError(
        `cards[${index}]: cannot infer \`type\` for metric "${metric}" — no matching sequence found on this block's runs; specify \`type\` explicitly`,
      );
    }
    if (matches.length > 1) {
      const types = matches.map((m) => m.object_type).join(", ");
      throw new CairnBlockError(
        `cards[${index}]: metric "${metric}" is ambiguous (found as ${types}) — specify \`type\` explicitly`,
      );
    }
    objectType = matches[0]!.object_type;
  }

  // One series per block runId, so the card still renders even where the
  // metric is missing (e.g. sequences not yet fetched).
  const runs = runIds.map((runId) => ({ runId }));

  return { kind: "series", name: metric, object_type: objectType, runs };
}

/**
 * Compile a validated `CairnSpec` into a `CardsBlock` + inline settings map.
 * `opts.resolvedRunIds` is the cell's runs right now (the union of its run
 * sets, resolved by the caller: `resolveRunSets` over the project's runs, or
 * a share link's server-resolved sets); without it the cards compile over no
 * runs. `metricIndex` should already be scoped to those runs. This function
 * stays pure and does no resolution itself.
 */
export function compileCairnBlock(
  spec: CairnSpec,
  metricIndex: MetricIndex,
  opts?: { id?: string; resolvedRunIds?: string[] },
): CompiledCairnBlock {
  const runSets = resolveRunSetsSpec(spec);
  const runView = resolveRunView(spec);
  const effectiveRunIds = opts?.resolvedRunIds ?? [];
  // Stabilized the same way the block id already is (opts.id/spec.id) — see
  // stableCardId's doc: card ids below are derived from this + each card's
  // own declared shape, never from resolved run/metric data, so they don't
  // churn across recompiles of the same fence.
  const blockId = opts?.id ?? spec.id ?? newId();

  const cards: ComparisonCard[] = [];
  const settings: Record<string, unknown> = {};
  const shapeOccurrences = new Map<string, number>();
  (spec.cards ?? []).forEach((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new CairnBlockError(`cards[${i}] must be a mapping`);
    }
    if (c.id !== undefined && (typeof c.id !== "string" || c.id.length === 0)) {
      throw new CairnBlockError(`cards[${i}].id must be a non-empty string`);
    }
    const sel = selectionForCard(c, i, metricIndex, effectiveRunIds);
    const card = cardFromSpec(sel);
    if (typeof c.id === "string") {
      card.id = c.id;
    } else {
      const shape = cardShapeKey(c);
      const occurrence = shapeOccurrences.get(shape) ?? 0;
      shapeOccurrences.set(shape, occurrence + 1);
      card.id = stableCardId(blockId, shape, occurrence);
    }
    cards.push(card);
    if (c.settings !== undefined) {
      if (typeof c.settings !== "object" || c.settings === null) {
        throw new CairnBlockError(`cards[${i}].settings must be a mapping`);
      }
      settings[card.id] = c.settings;
    }
  });

  const block: CardsBlock = {
    id: blockId,
    type: "cards",
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    runSets,
    ...(runView ? { runView } : {}),
    cards,
  };
  return { block, settings };
}

/** True when every series entry shares one metric name (the precondition for the compact `metric:` form). */
function seriesShareOneName(card: ComparisonCard): string | null {
  if (card.series.length === 0) return null;
  const names = new Set(card.series.map((s) => s.name));
  return names.size === 1 ? card.series[0]!.name : null;
}

/**
 * Serialize a `CardsBlock` (+ its inline settings map) to a ```cairn spec —
 * the inverse of `parseCairnSpec` + `compileCairnBlock`. A card over one
 * metric name is written in the compact `metric:`/`type:` form (its runs are
 * the cell's live runs); any other card in the fully-explicit `series:`
 * (manual-series) form, which `cardFromSpec` copies verbatim.
 */
export function serializeCairnSpec(block: CardsBlock, settingsByCardId: Record<string, unknown> = {}): CairnSpec {
  const doc: CairnSpec = { id: block.id };
  doc.runSets = block.runSets.map((s) => ({ ...s }));
  const view = block.runView;
  if (view && (view.hidden.length > 0 || view.pinned.length > 0 || view.baseline)) {
    doc.view = {};
    if (view.hidden.length > 0) doc.view.hidden = view.hidden;
    if (view.pinned.length > 0) doc.view.pinned = view.pinned;
    if (view.baseline) doc.view.baseline = view.baseline;
  }
  if (block.title !== undefined) doc.title = block.title;

  doc.cards = block.cards.map((card): CairnCardInput => {
    const cardSettings = settingsByCardId[card.id];
    const settingsField = cardSettings !== undefined ? { settings: cardSettings } : {};
    // Carry the id through explicitly: once a card has been
    // compiled once (whether its id came from an explicit `id:` or was
    // stably derived from its shape), writing it back out means the *next*
    // parse/compile uses this exact id verbatim — settings stay bound even
    // if a later edit changes the card's metric/type/series (which would
    // otherwise change its derived shape key).
    const idField = { id: card.id };

    if (isMultiRunCardType(card.type)) {
      return { type: card.type, ...idField, ...settingsField };
    }

    const name = seriesShareOneName(card);
    if (name !== null) {
      return { metric: name, type: card.type, ...idField, ...settingsField };
    }

    return {
      type: card.type,
      series: card.series.map((s) => ({ runId: s.runId, name: s.name })),
      ...idField,
      ...settingsField,
    };
  });

  return doc;
}

/** Render a `CairnSpec` (as produced by `serializeCairnSpec`) to YAML text — the literal ```cairn fence body. */
export function stringifyCairnSpec(spec: CairnSpec): string {
  return stringifyYamlDoc(spec, { lineWidth: 0 }).trimEnd();
}
