import { test } from "node:test";
import assert from "node:assert/strict";
import { throttledScheduler } from "./notify-throttle.ts";

function fakeClock() {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => void timers.push({ at: t + ms, fn }),
    advance(ms: number) {
      t += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > t) return;
        timers.shift();
        due.fn();
      }
    },
  };
}

test("an update after a quiet spell flushes on the next tick; a burst flushes at most once per interval", () => {
  const clock = fakeClock();
  const schedule = throttledScheduler(100, clock);
  const flushed: number[][] = [];
  let batch: number[] = [];
  const cb = (i: number) => () => batch.push(i);
  const take = () => { if (batch.length) flushed.push(batch); batch = []; };

  schedule(cb(1));
  clock.advance(0);
  take();
  assert.deepEqual(flushed, [[1]]);

  // A burst right after: held until 100 ms after the last flush, then all at once.
  for (let i = 2; i <= 6; i++) { schedule(cb(i)); clock.advance(10); }
  take();
  assert.deepEqual(flushed, [[1]]);
  clock.advance(60);
  take();
  assert.deepEqual(flushed, [[1], [2, 3, 4, 5, 6]]);

  // Quiet again: the next one goes out at once.
  clock.advance(500);
  schedule(cb(7));
  clock.advance(0);
  take();
  assert.deepEqual(flushed, [[1], [2, 3, 4, 5, 6], [7]]);
});
