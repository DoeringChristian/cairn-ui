/**
 * The Summary section's automatic cards (pure): a **Scalars** table (every
 * metric logged at a single step, the runs' `summary` values and run info)
 * and a **Config** table. Each stands in for a pseudo-series (`@scalars`,
 * `@config`) that the bound runs "log" when they have something to show, so
 * the automatic-card machinery of lib/workspace/layout.ts applies unchanged:
 * the card renders while some bound run has data and it is not removed,
 * touching it materializes it (`auto:@scalars`), removing it records the
 * pseudo-series in `removed`, and the run page hides it when the run has
 * nothing for it (`withoutEmptyPanels`).
 *
 * A metric logged at a single step (every bound run that logs it has one
 * point) goes into the Scalars table and gets no automatic card of its own.
 */

import type { MetricInfo } from "./layout.ts";

/** The automatic section of the Summary cards; it leads the page. */
export const SUMMARY_SECTION = "Summary";

export const SUMMARY_CARD_TYPES = ["scalars", "config"] as const;
export type SummaryCardType = (typeof SUMMARY_CARD_TYPES)[number];

const NAME_OF: Record<SummaryCardType, string> = { scalars: "@scalars", config: "@config" };
const SUMMARY_ORDER = SUMMARY_CARD_TYPES.map((t) => NAME_OF[t]);
const TYPE_OF: Record<string, SummaryCardType> = { "@scalars": "scalars", "@config": "config" };

export function isSummaryCardType(t: string): t is SummaryCardType {
  return (SUMMARY_CARD_TYPES as readonly string[]).includes(t);
}

/** The pseudo-series a Summary card stands in for. */
export function summaryNameOf(type: SummaryCardType): string {
  return NAME_OF[type];
}

/** The Summary card type of a pseudo-series name, else null. */
export function summaryTypeOfName(name: string): SummaryCardType | null {
  return TYPE_OF[name] ?? null;
}

/** The order of automatic panels: the Summary cards first (Scalars, Config), then A–Z. */
export function compareAutoNames(a: string, b: string): number {
  const ia = SUMMARY_ORDER.indexOf(a);
  const ib = SUMMARY_ORDER.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || 0;
  return a.localeCompare(b);
}

/** A scalar series with at most one point in every bound run: it belongs in the Scalars table. */
export function isSingleStepScalar(m: Pick<MetricInfo, "object_type" | "count">): boolean {
  return m.object_type === "scalar" && m.count <= 1;
}

/** What one bound run has for the Summary cards. */
export interface RunSummaryPresence {
  runId: string;
  /** `run.summary(...)` keys with a scalar value. */
  summaryKeys: number;
  /** Config keys. */
  configKeys: number;
  tags: number;
  notes: boolean;
}

/**
 * The pseudo-series of the Summary cards for the bound runs: `@scalars` for
 * the runs that log a single-step scalar or have summary values, `@config`
 * for those with config, tags or notes. A card without such runs is absent.
 */
export function summaryMetrics(metrics: readonly MetricInfo[], runs: readonly RunSummaryPresence[]): MetricInfo[] {
  const singleStep = new Set<string>();
  for (const m of metrics) if (isSingleStepScalar(m)) for (const r of m.runIds) singleStep.add(r);
  const scalars = runs.filter((r) => singleStep.has(r.runId) || r.summaryKeys > 0).map((r) => r.runId);
  const config = runs.filter((r) => r.configKeys > 0 || r.tags > 0 || r.notes).map((r) => r.runId);
  const out: MetricInfo[] = [];
  if (scalars.length) out.push({ name: NAME_OF.scalars, object_type: "scalars", count: 1, runIds: scalars });
  if (config.length) out.push({ name: NAME_OF.config, object_type: "config", count: 1, runIds: config });
  return out;
}

