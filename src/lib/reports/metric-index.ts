/**
 * The union of metrics available across a set of runs, shared by
 * AddCardModal and the ```cairn dialect interpreter (cairn-block.ts) so both
 * resolve a bare metric name to an `object_type` and a set of runIds the
 * same way. Pure data shaping; fetching
 * lives in use-metric-index.ts.
 */

import type { SequenceMeta } from "../../api/types";
import { isInternalName } from "../internal-names.ts";

export interface MetricIndexEntry {
  name: string;
  object_type: string;
  runs: Array<{ runId: string }>;
}

/** Keyed by `${name}::${object_type}` — the same grouping key AddCardModal uses. */
export type MetricIndex = Map<string, MetricIndexEntry>;

/**
 * Build the union of metrics across a set of runs' sequences. A metric name
 * may (rarely) appear with more than one `object_type` across runs — each
 * (name, object_type) pair gets its own entry, matching AddCardModal's
 * existing grouping semantics.
 */
export function buildMetricIndex(perRun: Array<{ runId: string; sequences: SequenceMeta[] }>): MetricIndex {
  const map: MetricIndex = new Map();
  for (const { runId, sequences } of perRun) {
    for (const seq of sequences) {
      if (isInternalName(seq.name)) continue;
      const key = `${seq.name}::${seq.object_type}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.runs.some((r) => r.runId === runId)) {
          existing.runs.push({ runId });
        }
      } else {
        map.set(key, {
          name: seq.name,
          object_type: seq.object_type,
          runs: [{ runId }],
        });
      }
    }
  }
  return map;
}

/** All entries for a given metric `name`, across every `object_type` it appears as. */
export function metricEntriesByName(index: MetricIndex, name: string): MetricIndexEntry[] {
  return Array.from(index.values()).filter((e) => e.name === name);
}
