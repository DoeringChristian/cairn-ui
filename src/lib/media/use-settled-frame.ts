/**
 * React bindings of the frame loader (see frame-loader.ts).
 *
 * `useSettledFrame(key, peek, load)`: the frame a pane shows. It switches in
 * the same render when `peek` has the requested frame ready, otherwise keeps
 * the previous frame on screen while `load` brings in a newer one — one load
 * at a time, never out of request order (see `FrameSwitch`).
 *
 * `useDecodedSrc(src)`: the same for one plain image URL.
 */

import { useEffect, useReducer, useRef } from "react";
import { ForegroundGate, FrameSwitch, PrefetchQueue, prefetchOrder, stepDirection, type PrefetchTask, type Shown } from "./frame-loader.ts";
import { decodeImage, peekDecoded, type DecodedImage } from "./decoded-image.ts";

/** Loads panes are waiting on, across every card: prefetching yields to them. */
const foreground = new ForegroundGate();

export interface SettledFrame<F> {
  /** The frame on screen: the requested one, or the held previous one; null before the first. */
  frame: F | null;
  /** Its key. */
  key: string | null;
  /** The requested frame is still loading (the pane holds `frame`). */
  pending: boolean;
}

/**
 * `key` names the requested frame and must change whenever anything `load`
 * would produce changes; `null` shows nothing. `peek` and `load` are read at
 * request time only (no need to memoise them). `load` gets an AbortSignal
 * that fires once its frame is no longer wanted; it should reject only then.
 */
export function useSettledFrame<F>(
  key: string | null,
  peek: () => F | undefined,
  load: (signal: AbortSignal) => Promise<F>,
): SettledFrame<F> {
  const swRef = useRef<FrameSwitch<F> | null>(null);
  if (swRef.current === null) swRef.current = new FrameSwitch<F>();
  const sw = swRef.current;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const running = useRef<{ key: string; ctrl: AbortController; end: () => void } | null>(null);
  const mounted = useRef(true);

  // Idempotent (StrictMode renders twice): same key, same peek → same state.
  const shown: Shown<F> | null = sw.request(key, peek);
  const pending = sw.pending;

  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    if (!mounted.current) return;
    const stale = sw.obsolete();
    if (stale && running.current?.key === stale) {
      running.current.ctrl.abort();
      running.current.end();
      running.current = null;
      sw.fail(stale);
    }
    const k = sw.next();
    if (k == null) return;
    const ctrl = new AbortController();
    const run = { key: k, ctrl, end: foreground.begin() };
    running.current = run;
    // Settlements of a load that was aborted (made obsolete) are ignored:
    // the switch already let go of it.
    const settle = (frame: F | null) => {
      run.end();
      if (running.current !== run) return;
      running.current = null;
      if (frame === null) sw.fail(k);
      else if (sw.resolve(k, frame) && mounted.current) rerender();
      pump.current();
    };
    loadRef.current(ctrl.signal).then(settle, () => settle(null));
  };

  useEffect(() => {
    pump.current();
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.ctrl.abort();
      running.current?.end();
      running.current = null;
    };
  }, []);

  return { frame: shown?.frame ?? null, key: shown?.key ?? null, pending };
}

/**
 * One image URL through the decoded cache: the last src that is decoded and
 * ready to paint, so an `<img>` swapping to a new URL never shows a blank.
 */
export function useDecodedSrc(src: string | null): { src: string | null; image: DecodedImage | null; pending: boolean } {
  const s = useSettledFrame<DecodedImage>(src, () => (src ? peekDecoded(src) : undefined), (signal) => decodeImage(src!, signal));
  return { src: s.frame?.src ?? null, image: s.frame, pending: s.pending };
}

export interface NeighbourPrefetchOptions {
  /** Positions warmed in the direction of travel (default 6). */
  ahead?: number;
  /** Positions warmed against it (default 2). */
  behind?: number;
  /** Concurrent prefetch loads, leaving browser connections for the pane's own (default 3). */
  concurrency?: number;
  /** Most tasks in one plan (default 32). */
  maxTasks?: number;
}

/**
 * Warm the slider position `index` (of `count`) and those around it, nearest first and
 * biased toward the direction the slider last moved, so stepping and
 * playback find their next frames decoded. `tasksAt(i)` lists what position
 * `i` needs (typically one frame load per pane); it is read when the index
 * changes. A new index replaces every prefetch that has not started yet.
 */
export function useNeighbourPrefetch(
  count: number,
  index: number,
  tasksAt: (i: number) => PrefetchTask[],
  opts: NeighbourPrefetchOptions = {},
): void {
  const { ahead = 6, behind = 2, concurrency = 3, maxTasks = 32 } = opts;
  const queue = useRef<PrefetchQueue | null>(null);
  useEffect(() => {
    const q = new PrefetchQueue(concurrency, foreground);
    queue.current = q;
    return () => {
      q.dispose();
      queue.current = null;
    };
  }, [concurrency]);
  const tasksRef = useRef(tasksAt);
  tasksRef.current = tasksAt;
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const direction = stepDirection(prev.current, index);
    prev.current = index;
    const q = queue.current;
    if (!q) return;
    if (count <= 1) {
      q.clear();
      return;
    }
    // The current position leads the plan: a load for it that a previous
    // plan started (as its neighbour) keeps running instead of being aborted
    // and restarted by the pane.
    const tasks = [index, ...prefetchOrder(count, index, { ahead, behind, direction })]
      .flatMap((i) => tasksRef.current(i))
      .slice(0, maxTasks);
    q.plan(tasks);
  }, [count, index, ahead, behind, maxTasks]);
}
