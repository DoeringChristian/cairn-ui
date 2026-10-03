/**
 * Batched sequence reads: every `api.sequence(runId, name)` asked for in the
 * same task goes out as one `GET /api/runs/{id}/series?name=…&name=…` per run
 * (split into chunks), instead of one request per series.
 *
 * The server sends each series column-wise (`columns`, plus `constant` for a
 * field equal at every point); `expandSeries` turns that back into exactly the
 * `SequenceResponse` the per-name endpoint returns, so every consumer and the
 * react-query cache (one entry per series, fed by the live-updates poller)
 * stay as they are.
 *
 * Pure apart from the injected `fetchBatch` and timer: tested in
 * `series-batch.test.ts`.
 */

import type { SequencePoint, SequenceResponse } from "./types.ts";

/** One series of a `/series` response. */
export interface WireSeries {
  name: string;
  count: number;
  cursor: number;
  columns: Record<string, unknown[]>;
  constant: Record<string, unknown>;
}

/** A `/series` response. */
export interface SeriesBatchResponse {
  run_id: string;
  data_epoch: number;
  cursor: number;
  series: WireSeries[];
}

/** Column-wise wire series → point objects (the per-name endpoint's shape). */
export function expandSeries(runId: string, s: WireSeries, dataEpoch: number): SequenceResponse {
  const keys = Object.keys(s.columns);
  const cols = keys.map((k) => s.columns[k]!);
  const points: SequencePoint[] = new Array(s.count);
  for (let i = 0; i < s.count; i++) {
    const p = { ...s.constant } as Record<string, unknown>;
    for (let k = 0; k < keys.length; k++) p[keys[k]!] = cols[k]![i];
    points[i] = p as unknown as SequencePoint;
  }
  return { run_id: runId, name: s.name, points, cursor: s.cursor, data_epoch: dataEpoch };
}

/** Limits of one request. */
export interface BatchLimits {
  /** Names per request (the server's cap is 200). */
  maxNames: number;
  /** Estimated points per request: keeps one response's parse short. */
  maxPoints: number;
  /** Characters of the query string (URL length). */
  maxQueryChars: number;
}

export const DEFAULT_LIMITS: BatchLimits = { maxNames: 100, maxPoints: 150_000, maxQueryChars: 6_000 };

/**
 * Split one run's names into requests. `size(name)` estimates a series'
 * points (unknown: 0); a series bigger than the budget goes alone.
 */
export function chunkNames(
  names: readonly string[],
  size: (name: string) => number,
  limits: BatchLimits = DEFAULT_LIMITS,
): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let points = 0;
  let chars = 0;
  for (const n of names) {
    const p = size(n);
    const c = encodeURIComponent(n).length + 6; // "&name="
    if (cur.length > 0 && (cur.length >= limits.maxNames || points + p > limits.maxPoints || chars + c > limits.maxQueryChars)) {
      out.push(cur);
      cur = [];
      points = 0;
      chars = 0;
    }
    cur.push(n);
    points += p;
    chars += c;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

interface Waiter {
  resolve: (r: SequenceResponse) => void;
  reject: (e: unknown) => void;
}

export interface SeriesBatcherOptions {
  fetchBatch: (runId: string, names: string[]) => Promise<SeriesBatchResponse>;
  /** Estimated points of a series (e.g. from the run's catalogue); 0 when unknown. */
  size?: (runId: string, name: string) => number;
  /** Schedules the flush; defaults to a macrotask, so one render's queries share it. */
  schedule?: (fn: () => void) => void;
  limits?: BatchLimits;
}

/** Collects `load` calls and answers them from as few `/series` requests as it can. */
export class SeriesBatcher {
  private queue = new Map<string, Map<string, Waiter[]>>();
  private scheduled = false;
  private readonly opts: SeriesBatcherOptions;

  constructor(opts: SeriesBatcherOptions) {
    this.opts = opts;
  }

  load(runId: string, name: string): Promise<SequenceResponse> {
    return new Promise((resolve, reject) => {
      let byName = this.queue.get(runId);
      if (!byName) this.queue.set(runId, (byName = new Map()));
      const waiters = byName.get(name);
      if (waiters) waiters.push({ resolve, reject });
      else byName.set(name, [{ resolve, reject }]);
      if (!this.scheduled) {
        this.scheduled = true;
        (this.opts.schedule ?? ((fn) => setTimeout(fn, 0)))(() => this.flush());
      }
    });
  }

  /** Send everything queued. */
  flush(): void {
    this.scheduled = false;
    const queue = this.queue;
    this.queue = new Map();
    for (const [runId, byName] of queue) {
      const size = (n: string) => this.opts.size?.(runId, n) ?? 0;
      for (const names of chunkNames([...byName.keys()], size, this.opts.limits)) {
        void this.send(runId, names, byName);
      }
    }
  }

  private async send(runId: string, names: string[], byName: Map<string, Waiter[]>): Promise<void> {
    try {
      const res = await this.opts.fetchBatch(runId, names);
      const got = new Map(res.series.map((s) => [s.name, s]));
      for (const n of names) {
        const s = got.get(n);
        const waiters = byName.get(n) ?? [];
        if (!s) {
          for (const w of waiters) w.reject(new Error(`series ${n} missing from the response`));
          continue;
        }
        // Each waiter gets its own copy: react-query owns what it is given.
        for (const w of waiters) w.resolve(expandSeries(runId, s, res.data_epoch));
      }
    } catch (e) {
      for (const n of names) for (const w of byName.get(n) ?? []) w.reject(e);
    }
  }
}

/** A series-size lookup over the run catalogues in `getCatalogue` (cached per catalogue object). */
export function catalogueSizeHint(
  getCatalogue: (runId: string) => { sequences: ReadonlyArray<{ name: string; count: number }> } | undefined,
): (runId: string, name: string) => number {
  const maps = new WeakMap<object, Map<string, number>>();
  return (runId, name) => {
    const cat = getCatalogue(runId);
    if (!cat) return 0;
    let m = maps.get(cat);
    if (!m) maps.set(cat, (m = new Map(cat.sequences.map((s) => [s.name, s.count]))));
    return m.get(name) ?? 0;
  };
}
