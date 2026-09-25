/**
 * Re-compiling a ```cairn fence that failed at hydrate time. The editor
 * parses a report before any run's sequence list is fetched, so a
 * `metric:` card with no `type:` can't have its type inferred then, even
 * though the metric exists. Once the cell's live metric index has loaded,
 * the cell compiles the fence again from its body. The result is only
 * displayed: it reaches the saved report when the user edits the cell.
 * Pure — the cell (ReportCardsBlock) does the fetching.
 */

import { CairnBlockError, compileCairnBlock, parseCairnSpec } from "./cairn-block.ts";
import type { MetricIndex } from "./metric-index";
import type { CardsBlock } from "./types";

export type RecompileDecision =
  /** Nothing to recompile: the cell compiled, or its fence can't benefit (no body, no runs). */
  | "none"
  /** The cell's runs or their metric index are still loading: show a loading state, not the error. */
  | "wait"
  /** Everything the fence needs is loaded: compile it again. */
  | "recompile";

export function recompileDecision(input: {
  block: Pick<CardsBlock, "error" | "errorSource">;
  /** The cell's (resolved) run ids. */
  runIds: string[];
  /** False while a `runs.selector` is still resolving. */
  runsResolved: boolean;
  /** True while any of the runs' sequence lists is still loading. */
  indexLoading: boolean;
}): RecompileDecision {
  const { block, runIds, runsResolved, indexLoading } = input;
  if (block.error === undefined || block.errorSource === undefined) return "none";
  if (!runsResolved) return "wait";
  if (runIds.length === 0) return "none";
  return indexLoading ? "wait" : "recompile";
}

export type RecompileResult =
  | { ok: true; block: CardsBlock; settings: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Compile a failed cell's fence body again against `metricIndex`. The
 * block keeps its id, so the recompiled cell replaces the failed one in
 * place. `resolvedRunIds` is the live run set of a `runs.selector` fence.
 */
export function recompileFailedBlock(
  block: CardsBlock,
  metricIndex: MetricIndex,
  resolvedRunIds?: string[],
): RecompileResult {
  if (block.errorSource === undefined) return { ok: false, error: block.error ?? "" };
  try {
    const spec = parseCairnSpec(block.errorSource);
    const compiled = compileCairnBlock(spec, metricIndex, { id: block.id, resolvedRunIds });
    return { ok: true, block: compiled.block, settings: compiled.settings };
  } catch (e) {
    return { ok: false, error: e instanceof CairnBlockError ? e.message : `Unexpected error: ${(e as Error).message}` };
  }
}
