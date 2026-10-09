/**
 * At most `max` tasks in flight; the rest wait their turn (FIFO).
 *
 * The API client's reads go through one: a workspace bound to 1000 runs
 * fires a few thousand GETs at once, and Chrome fails the overflow with
 * `net::ERR_INSUFFICIENT_RESOURCES` (each failure then retried). The server
 * answers at most a handful at a time anyway (HTTP/1.1: 6 connections).
 */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    active--;
    waiting.shift()?.();
  };
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}
