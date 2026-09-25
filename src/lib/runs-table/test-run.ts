/** Test fixtures for the runs-table modules (imported by `*.test.ts` only). */
import type { Run, RunMetricStats } from "../../api/types.ts";

export function makeRun(id: string, extra: Partial<Run> = {}): Run {
  return {
    id,
    project_id: "p",
    display_name: id,
    created_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    status: "completed",
    exit_code: null,
    git_sha: null,
    git_dirty: null,
    git_branch: null,
    cli_args: null,
    env_snapshot: null,
    hostname: null,
    user: null,
    tags: null,
    notes: null,
    git_remote: null,
    parent_run_id: null,
    fork_step: null,
    data_epoch: 0,
    group: null,
    job_type: null,
    sweep_id: null,
    stop_requested: null,
    ...extra,
  };
}

/** `run.stats` from `{metric: [min, max, rule?]}` (first = min, last = max, mean = midpoint). */
export function stats(spec: Record<string, [number, number, string?]>): Record<string, RunMetricStats> {
  const out: Record<string, RunMetricStats> = {};
  for (const [k, [min, max, rule]] of Object.entries(spec)) {
    out[k] = { count: 2, first: min, last: max, min, max, mean: (min + max) / 2, first_step: 0, last_step: 1, rule: rule ?? null };
  }
  return out;
}
