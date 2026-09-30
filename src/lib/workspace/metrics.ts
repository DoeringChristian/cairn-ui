/**
 * The metrics a workspace's bound runs log (pure): each run's sequences plus
 * its named artifacts (one entry per name, however many steps), merged by
 * name across runs. Internal `_cairn/` names never get a panel.
 */

import { isInternalName } from "../internal-names.ts";
import type { MetricInfo } from "./layout.ts";

export interface RunMetricsInput {
  runId: string;
  sequences: ReadonlyArray<{ name: string; object_type: string; count: number }>;
  /** Named artifacts (`log_artifact`); names that are also sequences are ignored. */
  artifactNames: readonly string[];
}

export function mergeRunMetrics(runs: readonly RunMetricsInput[]): MetricInfo[] {
  const byName = new Map<string, MetricInfo>();
  const add = (runId: string, name: string, objectType: string, count: number) => {
    if (isInternalName(name)) return;
    const m = byName.get(name);
    if (!m) {
      byName.set(name, { name, object_type: objectType, count, runIds: [runId] });
      return;
    }
    if (!m.runIds.includes(runId)) m.runIds.push(runId);
    m.count = Math.max(m.count, count);
  };
  for (const r of runs) {
    const seqNames = new Set(r.sequences.map((s) => s.name));
    for (const s of r.sequences) add(r.runId, s.name, s.object_type, s.count);
    const counts = new Map<string, number>();
    for (const a of r.artifactNames) if (!seqNames.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [name, n] of counts) add(r.runId, name, "artifact", n);
  }
  return [...byName.values()];
}
