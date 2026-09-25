/**
 * The pure core of flicker-free media stepping, shared by every media card.
 *
 * A stepped media pane never shows a frame that is not ready: moving the
 * slider only REQUESTS a new frame, and the pane keeps showing the one it
 * has until every resource of a newer frame (an image and its reference, a
 * gallery's manifest and entries, overlay masks) is loaded and decoded. Then
 * the whole frame swaps in one React commit. Frames never swap out of
 * request order, and a load nobody needs any more is aborted so it stops
 * taking bandwidth from the ones still wanted.
 *
 *  - {@link FrameSwitch}: the held/target state machine behind
 *    `useSettledFrame` (one load per pane at a time; each finished load that
 *    is newer than the frame on screen is shown, then the latest target).
 *  - {@link LruCache} / {@link AsyncCache}: bounded caches of settled values
 *    with a synchronous `peek` (so a frame whose resources are decoded already
 *    switches in the very render that asks for it), shared in-flight loads,
 *    and abort once every caller has abandoned a load.
 *  - {@link prefetchOrder} / {@link PrefetchQueue} / {@link ForegroundGate}:
 *    warm the slider's neighbours, nearest first and biased toward the
 *    direction of travel, with bounded concurrency; a new plan replaces what
 *    has not started and aborts what fell out of it, and prefetching pauses
 *    while any pane waits on a frame.
 *
 * Nothing here touches the DOM, so it runs under `node --test`.
 */

// ---------------------------------------------------------------------------
// Bounded LRU
// ---------------------------------------------------------------------------

export interface LruOptions<V> {
  /** Most entries kept. */
  maxEntries: number;
  /** Largest total weight kept (e.g. decoded bytes); unbounded when omitted. */
  maxWeight?: number;
  /** Weight of one value; 1 when omitted. */
  weigh?: (value: V) => number;
  onEvict?: (key: string, value: V) => void;
}

/**
 * Least-recently-used map bounded by entry count and total weight. The most
 * recently set entry is never evicted by its own insertion, so a single value
 * heavier than the budget is still kept until the next one arrives.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; weight: number }>();
  private total = 0;
  private readonly opts: LruOptions<V>;
  constructor(opts: LruOptions<V>) {
    this.opts = opts;
  }

  get size(): number {
    return this.map.size;
  }

  get weight(): number {
    return this.total;
  }

  /** The value, marking it most recently used. */
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /** The value, without touching its recency. */
  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.weight;
    }
    const weight = this.opts.weigh?.(value) ?? 1;
    this.map.set(key, { value, weight });
    this.total += weight;
    this.evict(key);
  }

  delete(key: string): boolean {
    const old = this.map.get(key);
    if (!old) return false;
    this.map.delete(key);
    this.total -= old.weight;
    return true;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  private evict(keep: string): void {
    const maxW = this.opts.maxWeight ?? Infinity;
    while (this.map.size > this.opts.maxEntries || (this.total > maxW && this.map.size > 1)) {
      const oldest = this.map.keys().next().value as string;
      if (oldest === keep) break;
      const entry = this.map.get(oldest)!;
      this.map.delete(oldest);
      this.total -= entry.weight;
      this.opts.onEvict?.(oldest, entry.value);
    }
  }
}

// ---------------------------------------------------------------------------
// Settled-value cache over async loads
// ---------------------------------------------------------------------------

/** The rejection of a load its caller abandoned. */
export class LoadAborted extends Error {
  constructor() {
    super("load aborted");
    this.name = "LoadAborted";
  }
}

interface Inflight<V> {
  promise: Promise<V>;
  ctrl: AbortController;
  /** Callers that passed a signal and have not aborted it. */
  waiters: number;
  /** A caller without a signal: the load always runs to the end. */
  pinned: boolean;
}

/**
 * Async loads keyed by string: one in-flight load per key (callers share it),
 * resolved values kept in an {@link LruCache} and readable synchronously with
 * {@link peek}. A rejected load is forgotten, so the next call retries.
 *
 * A caller may pass an `AbortSignal`: aborting it rejects that caller's
 * promise with {@link LoadAborted}, and once every caller of a load has
 * aborted the load itself is aborted (its loader's signal fires), so an
 * obsolete request stops taking bandwidth from the ones still wanted.
 */
export class AsyncCache<V> {
  private readonly pending = new Map<string, Inflight<V>>();
  readonly settled: LruCache<V>;
  constructor(settled: LruCache<V>) {
    this.settled = settled;
  }

  /** The settled value, when there is one (marks it recently used). */
  peek(key: string): V | undefined {
    return this.settled.get(key);
  }

  isLoading(key: string): boolean {
    return this.pending.has(key);
  }

  load(key: string, loader: (signal: AbortSignal) => Promise<V>, signal?: AbortSignal): Promise<V> {
    const hit = this.settled.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    if (signal?.aborted) return Promise.reject(new LoadAborted());
    let entry = this.pending.get(key);
    if (!entry) {
      const ctrl = new AbortController();
      const promise = (async () => loader(ctrl.signal))().then(
        (value) => {
          if (this.pending.get(key) === entry) this.pending.delete(key);
          if (!ctrl.signal.aborted) this.settled.set(key, value);
          return value;
        },
        (err: unknown) => {
          if (this.pending.get(key) === entry) this.pending.delete(key);
          throw err;
        },
      );
      promise.catch(() => {});
      entry = { promise, ctrl, waiters: 0, pinned: false };
      this.pending.set(key, entry);
    }
    const e = entry;
    if (!signal) {
      e.pinned = true;
      return e.promise;
    }
    e.waiters++;
    return new Promise<V>((resolve, reject) => {
      const onAbort = () => {
        e.waiters--;
        if (!e.pinned && e.waiters === 0) {
          if (this.pending.get(key) === e) this.pending.delete(key);
          e.ctrl.abort();
        }
        reject(new LoadAborted());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      e.promise.then(
        (v) => { signal.removeEventListener("abort", onAbort); e.waiters--; resolve(v); },
        (err: unknown) => { signal.removeEventListener("abort", onAbort); e.waiters--; reject(err); },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Held frame / ordered swaps
// ---------------------------------------------------------------------------

export interface Shown<F> {
  key: string;
  frame: F;
}

/**
 * What a pane shows while it steps, and what it loads next.
 *
 * `request(key)` names the frame the pane wants. It shows at once when `peek`
 * has it ready; otherwise the pane keeps showing the frame it has (the HELD
 * frame) and `next()` says what to load. At most ONE load runs per pane: while
 * it runs, newer requests only move the target. When it finishes it is shown
 * if it was requested after the frame on screen — so fast scrubbing still
 * advances frame by frame, and an older request can never paint over a newer
 * one — and `next()` then hands out the latest target. `obsolete()` names a
 * running load nobody needs any more (its target got shown another way), to
 * be aborted. `request(null)` clears the pane immediately.
 */
export class FrameSwitch<F> {
  private shownState: Shown<F> | null = null;
  private shownSeq = 0;
  private targetKey: string | null = null;
  private targetSeq = 0;
  private seq = 0;
  private running: { key: string; seq: number } | null = null;

  get shown(): Shown<F> | null {
    return this.shownState;
  }

  get target(): string | null {
    return this.targetKey;
  }

  /** The key being loaded, if any. */
  get loading(): string | null {
    return this.running?.key ?? null;
  }

  /** The requested frame is not on screen yet. */
  get pending(): boolean {
    return this.targetKey != null && this.shownState?.key !== this.targetKey;
  }

  request(key: string | null, peek: () => F | undefined): Shown<F> | null {
    if (key !== this.targetKey) {
      this.targetKey = key;
      this.targetSeq = ++this.seq;
    }
    if (key == null) {
      this.shownState = null;
      this.shownSeq = this.targetSeq;
      return null;
    }
    if (this.shownState?.key === key) return this.shownState;
    const ready = peek();
    if (ready !== undefined) {
      this.shownState = { key, frame: ready };
      this.shownSeq = this.targetSeq;
    }
    return this.shownState;
  }

  /** The key to start loading now, if any (marks it running). */
  next(): string | null {
    if (this.running || !this.pending) return null;
    this.running = { key: this.targetKey!, seq: this.targetSeq };
    return this.running.key;
  }

  /** A running load nobody needs any more; the caller aborts it (then `fail`s it). */
  obsolete(): string | null {
    if (!this.running) return null;
    if (this.pending && this.running.seq > this.shownSeq) return null;
    return this.running.key;
  }

  /** The running load delivered its frame; true when it is now shown. */
  resolve(key: string, frame: F): boolean {
    const run = this.running;
    if (!run || run.key !== key) return false;
    this.running = null;
    if (run.seq <= this.shownSeq) return false;
    this.shownState = { key, frame };
    this.shownSeq = run.seq;
    return true;
  }

  /** The running load failed or was aborted. */
  fail(key: string): void {
    if (this.running?.key === key) this.running = null;
  }
}

// ---------------------------------------------------------------------------
// Prefetch window + bounded queue
// ---------------------------------------------------------------------------

export type Direction = -1 | 0 | 1;

/** Direction of travel from one slider index to the next. */
export function stepDirection(prev: number | null | undefined, next: number): Direction {
  if (prev == null || prev === next) return 0;
  return next > prev ? 1 : -1;
}

export interface PrefetchWindow {
  /** Positions to warm in the direction of travel. */
  ahead: number;
  /** Positions to warm against it. */
  behind: number;
  /** Direction of travel; 0 warms `ahead` positions on both sides. */
  direction: Direction;
}

/**
 * Slider indices to prefetch around `index` (excluded) among `count`
 * positions, nearest first. Ties between the two sides go to the direction of
 * travel (forward when standing still), and the far side only gets `behind`
 * positions while moving.
 */
export function prefetchOrder(count: number, index: number, win: PrefetchWindow): number[] {
  const dir = win.direction === 0 ? 1 : win.direction;
  const fwdN = win.ahead;
  const backN = win.direction === 0 ? win.ahead : win.behind;
  const out: number[] = [];
  const max = Math.max(fwdN, backN);
  for (let d = 1; d <= max; d++) {
    const f = index + dir * d;
    const b = index - dir * d;
    if (d <= fwdN && f >= 0 && f < count) out.push(f);
    if (d <= backN && b >= 0 && b < count) out.push(b);
  }
  return out;
}

export interface PrefetchTask {
  key: string;
  run: (signal: AbortSignal) => Promise<unknown>;
}

/**
 * Counts the loads a pane is WAITING on (frames the user asked for and does
 * not see yet). While any runs, prefetching pauses, so the frame on demand
 * gets the whole connection instead of a share of it.
 */
export class ForegroundGate {
  private active = 0;
  private readonly listeners = new Set<() => void>();

  get busy(): boolean {
    return this.active > 0;
  }

  /** A foreground load started; call the returned function once it settles. */
  begin(): () => void {
    this.active++;
    if (this.active === 1) this.emit();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.active--;
      if (this.active === 0) this.emit();
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

/**
 * Runs prefetch tasks with bounded concurrency. `plan` replaces every task
 * that has not started (the previous neighbourhood is obsolete once the
 * slider moves), keeps running tasks that are still planned, and aborts the
 * running ones that are not. A task's failure is ignored — prefetching is
 * best effort, the pane's own load reports errors. With a `gate`, nothing
 * runs while a foreground load does: running tasks are aborted and requeued
 * in front, and resume once the gate is idle.
 */
export class PrefetchQueue {
  private queue: PrefetchTask[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly concurrency: number;
  private readonly gate: ForegroundGate | null;
  private readonly unsubscribe: () => void;
  private readonly runningTasks = new Map<string, PrefetchTask>();
  constructor(concurrency: number, gate?: ForegroundGate) {
    this.concurrency = concurrency;
    this.gate = gate ?? null;
    this.unsubscribe = this.gate?.subscribe(() => (this.gate!.busy ? this.pause() : this.pump())) ?? (() => {});
  }

  get running(): number {
    return this.active.size;
  }

  /** Stop listening to the gate and drop everything. */
  dispose(): void {
    this.unsubscribe();
    this.clear();
  }

  get queued(): number {
    return this.queue.length;
  }

  plan(tasks: readonly PrefetchTask[]): void {
    const wanted = new Set(tasks.map((t) => t.key));
    for (const [key, ctrl] of this.active) {
      if (!wanted.has(key)) {
        ctrl.abort();
        this.active.delete(key);
        this.runningTasks.delete(key);
      }
    }
    const seen = new Set<string>();
    this.queue = tasks.filter((t) => {
      if (this.active.has(t.key) || seen.has(t.key)) return false;
      seen.add(t.key);
      return true;
    });
    this.pump();
  }

  /** Drop the queue and abort everything running. */
  clear(): void {
    this.plan([]);
  }

  private pause(): void {
    const requeue = [...this.runningTasks.values()];
    for (const ctrl of this.active.values()) ctrl.abort();
    this.active.clear();
    this.runningTasks.clear();
    this.queue = [...requeue, ...this.queue];
  }

  private pump(): void {
    while (!this.gate?.busy && this.active.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      const ctrl = new AbortController();
      this.active.set(task.key, ctrl);
      this.runningTasks.set(task.key, task);
      let p: Promise<unknown>;
      try {
        p = task.run(ctrl.signal);
      } catch {
        p = Promise.resolve();
      }
      p.catch(() => {}).finally(() => {
        if (this.active.get(task.key) === ctrl) {
          this.active.delete(task.key);
          this.runningTasks.delete(task.key);
        }
        this.pump();
      });
    }
  }
}
