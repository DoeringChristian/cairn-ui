/**
 * Batched per-run reads: every `api.run(id)`, `api.sequences(id)` and
 * `api.runOutputArtifacts(id)` asked for in the same task goes out as
 * `POST /api/runs/batch` (`{ids, include}`, at most `maxIds` runs a
 * request) instead of one GET per run and part. A workspace bound to a
 * thousand runs asked for three thousand GETs; now it is a handful of
 * requests. A task that asks about one run alone uses its per-run routes,
 * as before.
 *
 * Each part of the response is exactly its per-run route's body, so every
 * react-query entry stays keyed per run (`qk.run`, `qk.sequences`,
 * `qk.runOutputArtifacts`) and every page shares them.
 *
 * Pure apart from the injected fetches and timer: tested in
 * `run-batch.test.ts`.
 */

/** What `POST /api/runs/batch` can return per run. */
export type RunPart = "run" | "sequences" | "outputs";

/** The parts in the order the server documents them (a request's `include`). */
export const RUN_PARTS: readonly RunPart[] = ["run", "sequences", "outputs"];

/** A `POST /api/runs/batch` response. */
export interface RunsBatchResponse {
  runs: Record<string, Partial<Record<RunPart, unknown>>>;
  /** Ids of no run (the per-run routes' 404). */
  missing: string[];
  /** Through a share link: ids outside the shared report (the per-run routes' 403). */
  forbidden: string[];
}

interface Waiter {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export interface RunBatcherOptions {
  /** `POST /api/runs/batch`. */
  fetchBatch: (ids: string[], include: RunPart[]) => Promise<RunsBatchResponse>;
  /** One run's part from its per-run route (a task that asks about one run). */
  fetchOne: (id: string, part: RunPart) => Promise<unknown>;
  /** The error a run's `missing` (404) or `forbidden` (403) answer rejects with. */
  error: (status: 403 | 404, id: string, part: RunPart) => unknown;
  /** Schedules the flush; defaults to a macrotask, so one render's queries share it. */
  schedule?: (fn: () => void) => void;
  /** Runs per request. */
  maxIds?: number;
}

/** Runs per `POST /api/runs/batch` (the server takes up to 1000). */
export const DEFAULT_MAX_IDS = 200;

/**
 * The requests one flush sends: the runs grouped by the parts asked for
 * (each group one `include`), in chunks of `maxIds`. A part's order is
 * `RUN_PARTS`'; the groups come in the order their first run was asked for.
 */
export function planBatches(
  asked: ReadonlyMap<string, ReadonlySet<RunPart>>,
  maxIds: number = DEFAULT_MAX_IDS,
): { ids: string[]; include: RunPart[] }[] {
  const groups = new Map<string, { include: RunPart[]; ids: string[] }>();
  for (const [id, parts] of asked) {
    const include = RUN_PARTS.filter((p) => parts.has(p));
    const key = include.join(",");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { include, ids: [] }));
    g.ids.push(id);
  }
  const out: { ids: string[]; include: RunPart[] }[] = [];
  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += maxIds) out.push({ ids: g.ids.slice(i, i + maxIds), include: g.include });
  }
  return out;
}

/** Collects `load` calls and answers them from as few requests as it can. */
export class RunBatcher {
  private queue = new Map<string, Map<RunPart, Waiter[]>>();
  private scheduled = false;
  private readonly opts: RunBatcherOptions;

  constructor(opts: RunBatcherOptions) {
    this.opts = opts;
  }

  load(id: string, part: RunPart): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let parts = this.queue.get(id);
      if (!parts) this.queue.set(id, (parts = new Map()));
      const waiters = parts.get(part);
      if (waiters) waiters.push({ resolve, reject });
      else parts.set(part, [{ resolve, reject }]);
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
    if (queue.size === 1) {
      const [[id, parts]] = [...queue];
      for (const [part, waiters] of parts) {
        this.opts.fetchOne(id, part).then(
          (v) => waiters.forEach((w) => w.resolve(v)),
          (e) => waiters.forEach((w) => w.reject(e)),
        );
      }
      return;
    }
    const asked = new Map([...queue].map(([id, parts]) => [id, new Set(parts.keys())]));
    for (const { ids, include } of planBatches(asked, this.opts.maxIds)) void this.send(ids, include, queue);
  }

  private async send(ids: string[], include: RunPart[], queue: Map<string, Map<RunPart, Waiter[]>>): Promise<void> {
    let res: RunsBatchResponse;
    try {
      res = await this.opts.fetchBatch(ids, include);
    } catch (e) {
      for (const id of ids) for (const waiters of queue.get(id)!.values()) for (const w of waiters) w.reject(e);
      return;
    }
    const missing = new Set(res.missing);
    const forbidden = new Set(res.forbidden);
    for (const id of ids) {
      for (const [part, waiters] of queue.get(id)!) {
        const got = res.runs[id];
        if (got && part in got) {
          for (const w of waiters) w.resolve(got[part]);
          continue;
        }
        const status = forbidden.has(id) ? 403 : 404;
        const err = missing.has(id) || forbidden.has(id) ? this.opts.error(status, id, part) : new Error(`run ${id}: ${part} missing from the response`);
        for (const w of waiters) w.reject(err);
      }
    }
  }
}
