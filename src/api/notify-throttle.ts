/**
 * A TanStack Query notify scheduler (`notifyManager.setScheduler`) that
 * renders a burst of query updates together: the first update after a quiet
 * spell flushes on the next tick (as the default scheduler does), and while
 * updates keep arriving they are flushed at most once per `intervalMs`, all
 * callbacks of a flush in one task (so React batches them into one render).
 *
 * A workspace or report over 1000 runs receives a response every few
 * milliseconds for seconds; with the default scheduler each response was its
 * own render of every card over all the runs (O(runs²) work in total).
 */
export function throttledScheduler(
  intervalMs: number,
  {
    now = () => Date.now(),
    setTimer = (fn: () => void, ms: number) => {
      setTimeout(fn, ms);
    },
  }: { now?: () => number; setTimer?: (fn: () => void, ms: number) => void } = {},
): (callback: () => void) => void {
  let queue: Array<() => void> = [];
  let scheduled = false;
  let lastFlush = -Infinity;
  const flush = () => {
    scheduled = false;
    lastFlush = now();
    const run = queue;
    queue = [];
    for (const cb of run) cb();
  };
  return (callback) => {
    queue.push(callback);
    if (scheduled) return;
    scheduled = true;
    setTimer(flush, Math.max(0, lastFlush + intervalMs - now()));
  };
}
