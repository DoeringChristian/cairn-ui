/**
 * A run's series: its (group, job type, name), the key the server numbers
 * versions in. `exp-44 · train` and `exp-43 · train` are different series,
 * and so is the same name under two job types; a missing group or job type
 * is part of the key. A run without a name is its own series (keyed by its
 * id). Mirrored by cairn/server/run_series.py `run_series_key`.
 */
import type { Run } from "../api/types.ts";

type SeriesRun = Pick<Run, "id" | "group" | "job_type" | "display_name">;

/** The series key: `["<group>"|null, "<job_type>"|null, "<name>"|"<id>"]` as JSON. */
export function runSeriesKey(run: SeriesRun): string {
  return JSON.stringify([run.group ?? null, run.job_type ?? null, run.display_name || run.id]);
}

/** Whether `a` is newer than `b` in one series: the higher version when both have one, else the later created_at. */
export function newerInSeries(a: Pick<Run, "version" | "created_at">, b: Pick<Run, "version" | "created_at">): boolean {
  if (a.version != null && b.version != null && a.version !== b.version) return a.version > b.version;
  return a.created_at > b.created_at;
}

/** The runs of every series, by series key, in input order. */
export function bySeries<R extends SeriesRun>(runs: readonly R[]): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const r of runs) {
    const k = runSeriesKey(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** The newest run of each series (`newerInSeries`). */
export function newestOfSeries<R extends SeriesRun & Pick<Run, "version" | "created_at">>(runs: readonly R[]): R[] {
  return [...bySeries(runs).values()].map((list) => list.reduce((best, r) => (newerInSeries(r, best) ? r : best)));
}

/** "Archive / Delete old": every run but the newest of its series. */
export function olderInSeries<R extends SeriesRun & Pick<Run, "version" | "created_at">>(runs: readonly R[]): R[] {
  const keep = new Set(newestOfSeries(runs).map((r) => r.id));
  return runs.filter((r) => !keep.has(r.id));
}
