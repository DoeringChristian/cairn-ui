/**
 * Batched sequence reads: every `api.sequence(runId, name)` asked for in the
 * same task goes out as one `GET /api/runs/{id}/series?name=…&name=…` per run
 * (split into chunks), instead of one request per series; when the task
 * asks about several runs, their chunks are packed into
 * `POST /api/runs/series` requests (`{runs: {id: [name]}}`, a workspace's
 * charts over a thousand runs) instead of one request per run.
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

/** A `POST /api/runs/series` response. */
export interface SeriesManyResponse {
  runs: Record<string, SeriesBatchResponse>;
  /** Ids of no run (the per-run route's 404). */
  missing: string[];
  /** Through a share link: ids outside the shared report (the per-run route's 403). */
  forbidden: string[];
}

/** Limits of one request. */
export interface BatchLimits {
  /** Names per run per request (the server's cap is 200). */
  maxNames: number;
  /** Estimated points per request: keeps one response's parse short. */
  maxPoints: number;
  /** Characters of the query string (URL length). */
  maxQueryChars: number;
  /** Runs per `POST /api/runs/series` (several requests answer in parallel). */
  maxRuns: number;
  /** Names over every run of a `POST /api/runs/series` (the server's cap is 5000). */
  maxTotalNames: number;
}

export const DEFAULT_LIMITS: BatchLimits = {
  maxNames: 100,
  maxPoints: 150_000,
  maxQueryChars: 6_000,
  maxRuns: 100,
  maxTotalNames: 2_000,
};

/** One run's names in one request, with their estimated points. */
export interface RunChunk {
  runId: string;
  names: string[];
  points: number;
}

/**
 * Pack run chunks into `POST /api/runs/series` requests, in order: a new
 * request when the next chunk's run is already in the current one, or the
 * run, point or name budget would be exceeded (a chunk over the point
 * budget goes alone, never dropped).
 */
export function packRuns(chunks: readonly RunChunk[], limits: BatchLimits = DEFAULT_LIMITS): RunChunk[][] {
  const out: RunChunk[][] = [];
  let cur: RunChunk[] = [];
  let runs = new Set<string>();
  let points = 0;
  let names = 0;
  for (const c of chunks) {
    if (
      cur.length > 0 &&
      (runs.has(c.runId) || cur.length >= limits.maxRuns || points + c.points > limits.maxPoints || names + c.names.length > limits.maxTotalNames)
    ) {
      out.push(cur);
      cur = [];
      runs = new Set();
      points = 0;
      names = 0;
    }
    cur.push(c);
    runs.add(c.runId);
    points += c.points;
    names += c.names.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

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
  /** `POST /api/runs/series`; absent: one `fetchBatch` per run. */
  fetchMany?: (runs: Record<string, string[]>) => Promise<SeriesManyResponse>;
  /** The error a run's `missing` (404) or `forbidden` (403) answer rejects with. */
  error?: (status: 403 | 404, runId: string) => unknown;
  /** Estimated points of a series (e.g. from the run's catalogue); 0 when unknown. */
  size?: (runId: string, name: string) => number;
  /** Schedules the flush; defaults to a macrotask, so one render's queries share it. */
  schedule?: (fn: () => void) => void;
  limits?: Partial<BatchLimits>;
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
    const limits = { ...DEFAULT_LIMITS, ...this.opts.limits };
    const chunks: RunChunk[] = [];
    for (const [runId, byName] of queue) {
      const size = (n: string) => this.opts.size?.(runId, n) ?? 0;
      for (const names of chunkNames([...byName.keys()], size, limits)) {
        chunks.push({ runId, names, points: names.reduce((a, n) => a + size(n), 0) });
      }
    }
    const fetchMany = this.opts.fetchMany;
    if (!fetchMany || queue.size === 1) {
      for (const c of chunks) void this.send(c.runId, c.names, queue.get(c.runId)!);
      return;
    }
    for (const req of packRuns(chunks, limits)) void this.sendMany(fetchMany, req, queue);
  }

  private async send(runId: string, names: string[], byName: Map<string, Waiter[]>): Promise<void> {
    try {
      answer(runId, names, byName, await this.opts.fetchBatch(runId, names));
    } catch (e) {
      for (const n of names) for (const w of byName.get(n) ?? []) w.reject(e);
    }
  }

  private async sendMany(
    fetchMany: NonNullable<SeriesBatcherOptions["fetchMany"]>,
    req: RunChunk[],
    queue: Map<string, Map<string, Waiter[]>>,
  ): Promise<void> {
    let res: SeriesManyResponse;
    try {
      res = await fetchMany(Object.fromEntries(req.map((c) => [c.runId, c.names])));
    } catch (e) {
      for (const c of req) for (const n of c.names) for (const w of queue.get(c.runId)!.get(n) ?? []) w.reject(e);
      return;
    }
    for (const c of req) {
      const byName = queue.get(c.runId)!;
      const got = res.runs[c.runId];
      if (got) {
        answer(c.runId, c.names, byName, got);
        continue;
      }
      const status = res.forbidden.includes(c.runId) ? 403 : 404;
      const known = status === 403 || res.missing.includes(c.runId);
      const err = known && this.opts.error ? this.opts.error(status, c.runId) : new Error(`run ${c.runId} missing from the response`);
      for (const n of c.names) for (const w of byName.get(n) ?? []) w.reject(err);
    }
  }
}

/** Resolve `names`' waiters from one run's `/series` body. */
function answer(runId: string, names: string[], byName: Map<string, Waiter[]>, res: SeriesBatchResponse): void {
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
