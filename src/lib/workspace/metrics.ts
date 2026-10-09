/**
 * The metrics a workspace's bound runs log (pure): each run's sequences plus
 * the artifacts it logged (one entry per artifact name, however many
 * versions), merged by name across runs. Internal `_cairn/` names never get
 * a panel.
 */

import { isInternalName } from "../internal-names.ts";
import type { MetricInfo } from "./layout.ts";

export interface RunMetricsInput {
  runId: string;
  sequences: ReadonlyArray<{ name: string; object_type: string; count: number; kind?: string | null }>;
  /** Names of the artifact versions the run logged (`log_artifact`), one per
   * version; names that are also sequences are ignored. */
  artifactNames: readonly string[];
}

export function mergeRunMetrics(runs: readonly RunMetricsInput[]): MetricInfo[] {
  const byName = new Map<string, MetricInfo>();
  // Which runs each name already lists: `runIds.includes` was O(runs²) per metric.
  const listed = new Map<string, Set<string>>();
  const add = (runId: string, name: string, objectType: string, count: number, kind?: string | null) => {
    if (isInternalName(name)) return;
    const m = byName.get(name);
    if (!m) {
      byName.set(name, { name, object_type: objectType, count, runIds: [runId], ...(kind ? { kind } : {}) });
      listed.set(name, new Set([runId]));
      return;
    }
    if (!m.kind && kind) m.kind = kind;
    const ids = listed.get(name)!;
    if (!ids.has(runId)) {
      ids.add(runId);
      m.runIds.push(runId);
    }
    m.count = Math.max(m.count, count);
  };
  for (const r of runs) {
    const seqNames = new Set(r.sequences.map((s) => s.name));
    for (const s of r.sequences) add(r.runId, s.name, s.object_type, s.count, s.kind);
    const counts = new Map<string, number>();
    for (const a of r.artifactNames) if (!seqNames.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [name, n] of counts) add(r.runId, name, "artifact", n);
  }
  return [...byName.values()];
}
