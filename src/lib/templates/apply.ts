// ---------------------------------------------------------------------------
// Resolve a template against a run set. Applying a comparison template and a
// report template differ only in what they build from the matched cards.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { isInternalName } from "../internal-names";
import { matchTemplateCards } from "../comparisons/template-match";
import type { MatchedTemplateCard, SeqMap, SeriesEntry } from "../comparisons/template-match";
import type { Template } from "./store";

/**
 * Fetch sequences for `runIds` and build the metric-name -> series map used by
 * `matchTemplateCards`.
 *
 * One entry per (run, name).
 */
export async function buildSeqMap(runIds: string[]): Promise<SeqMap> {
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));
  const seqMap: SeqMap = new Map();
  seqResults.forEach((result, idx) => {
    const runId = runIds[idx]!;
    for (const seq of result.sequences) {
      if (isInternalName(seq.name)) continue;
      const entry: SeriesEntry = { runId, name: seq.name };
      const existing = seqMap.get(seq.name);
      if (existing) {
        if (!existing.some((s) => s.runId === runId)) {
          existing.push(entry);
        }
      } else {
        seqMap.set(seq.name, [entry]);
      }
    }
  });
  return seqMap;
}

/**
 * The template cards `runIds` can reconstruct, each with its series. Callers
 * match before creating anything, so a zero-match apply leaves nothing
 * behind, and report "restored N of M cards" from `matched.length` and
 * `template.cards.length`.
 */
export async function matchTemplateToRuns(
  template: Template,
  runIds: string[],
): Promise<MatchedTemplateCard[]> {
  return matchTemplateCards(template, runIds, await buildSeqMap(runIds));
}
