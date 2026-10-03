import assert from "node:assert/strict";
import test from "node:test";

import { GestureCommitter, ZoomViewSync } from "./zoom-view-sync.ts";

const v = (zoom: number) => ({ zoom, cx: 0.5, cy: 0.5 });

test("a published view reaches every other pane, not the publisher", () => {
  const sync = new ZoomViewSync();
  const seen: string[] = [];
  const pane = (name: string) => ({ show: (view: { zoom: number }) => seen.push(`${name}:${view.zoom}`) });
  const a = pane("a"), b = pane("b"), c = pane("c");
  sync.join(a);
  const leaveB = sync.join(b);
  sync.join(c);
  sync.publish(v(2), a);
  assert.deepEqual(seen, ["b:2", "c:2"]);
  leaveB();
  sync.publish(v(3), c);
  assert.deepEqual(seen, ["b:2", "c:2", "a:3"]);
  assert.equal(sync.size, 2);
});

function fakeTimers() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t: ReturnType<typeof setTimeout>) => {
      const i = timers.findIndex((x) => x.id === (t as unknown as number));
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
  };
}

test("a drag commits once, after it ends and the view settles", () => {
  const t = fakeTimers();
  const commits: number[] = [];
  const g = new GestureCommitter((view) => commits.push(view.zoom), { quietMs: 150, ...t });
  g.start();
  for (let i = 1; i <= 5; i++) {
    g.changed(v(i));
    t.advance(500); // a slow drag: no commit while the button is down
  }
  assert.deepEqual(commits, []);
  g.stop();
  t.advance(100);
  g.changed(v(6)); // release animation
  t.advance(100);
  assert.deepEqual(commits, []);
  t.advance(60);
  assert.deepEqual(commits, [6]);
  t.advance(1000);
  assert.deepEqual(commits, [6]);
});

test("wheel zoom commits once input is quiet", () => {
  const t = fakeTimers();
  const commits: number[] = [];
  const g = new GestureCommitter((view) => commits.push(view.zoom), { quietMs: 150, ...t });
  g.changed(v(1.1));
  t.advance(50);
  g.changed(v(1.2));
  t.advance(149);
  assert.deepEqual(commits, []);
  t.advance(1);
  assert.deepEqual(commits, [1.2]);
});

test("flush commits what is pending now; nothing pending, nothing committed", () => {
  const t = fakeTimers();
  const commits: number[] = [];
  const g = new GestureCommitter((view) => commits.push(view.zoom), { quietMs: 150, ...t });
  g.flush();
  g.start();
  g.changed(v(4));
  g.flush();
  assert.deepEqual(commits, [4]);
  t.advance(1000);
  assert.deepEqual(commits, [4]);
});
