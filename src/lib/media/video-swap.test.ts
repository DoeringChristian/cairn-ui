import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameLock, SwapBarrier, pairKey, requestPair, slotElements, videoFrameReady } from "./video-swap.ts";

const media = (over: Partial<{ readyState: number; seeking: boolean; currentTime: number; duration: number }> = {}) => ({
  readyState: 4, seeking: false, currentTime: 1, duration: 4, ...over,
});

test("a video is ready once its frame at the clock's position is decoded", () => {
  assert.ok(videoFrameReady(media(), 1, false));
  assert.ok(!videoFrameReady(media({ readyState: 1 }), 1, false), "metadata only");
  assert.ok(!videoFrameReady(media({ seeking: true }), 1, false), "seek in flight");
  assert.ok(!videoFrameReady(media({ currentTime: 0 }), 1, false), "still at the start");
  assert.ok(videoFrameReady(media({ currentTime: 1.04 }), 1, false));
});

test("playing or paused, ready means within about a frame of the clock", () => {
  assert.ok(videoFrameReady(media({ currentTime: 1.04 }), 1, true));
  assert.ok(!videoFrameReady(media({ currentTime: 1.2 }), 1, true));
  assert.ok(videoFrameReady(media({ currentTime: 1.2 }), 1, true, { playingTolerance: 0.3 }));
});

test("where frame callbacks exist, ready waits for the compositor to have the current frame", () => {
  assert.ok(!videoFrameReady(media(), 1, false, { presentedTime: null }), "nothing presented yet");
  assert.ok(!videoFrameReady(media(), 1, false, { presentedTime: 0 }), "the pre-seek frame");
  assert.ok(videoFrameReady(media(), 1, false, { presentedTime: 0.9667 }), "the frame covering t=1");
  assert.ok(videoFrameReady(media({ currentTime: 1.02 }), 1, true, { presentedTime: 1.0 }));
});

test("a clip shorter than the clock is ready on its last frame", () => {
  assert.ok(videoFrameReady(media({ currentTime: 2, duration: 2 }), 5, false));
  assert.ok(!videoFrameReady(media({ currentTime: 1, duration: 2 }), 5, false));
  // Unknown duration: the clock's position as is.
  assert.ok(videoFrameReady(media({ currentTime: 5, duration: Number.NaN }), 5, false));
});

test("the barrier opens once every waiting pane is ready", () => {
  const b = new SwapBarrier();
  let events = 0;
  b.subscribe(() => events++);
  assert.ok(b.open, "nothing waits");
  b.wait("a");
  b.wait("b");
  assert.ok(!b.open);
  b.ready("a");
  assert.ok(!b.open, "b still loads");
  b.ready("b");
  assert.ok(b.open);
  b.done("a");
  b.done("b");
  assert.ok(b.open);
  assert.equal(events, 6);
  assert.ok(!b.isWaiting("a"));
});

test("barrier: repeated and unknown calls are no-ops; a new wait closes it again", () => {
  const b = new SwapBarrier();
  let events = 0;
  b.subscribe(() => events++);
  b.ready("x");
  b.done("x");
  assert.equal(events, 0);
  b.wait("a");
  b.wait("a");
  assert.equal(events, 1);
  b.ready("a");
  b.ready("a");
  assert.equal(events, 2);
  b.wait("a"); // a newer pending swap of the same pane
  assert.ok(!b.open);
});

test("barrier listeners may swap (call done) while being notified", () => {
  const b = new SwapBarrier();
  const swapped: string[] = [];
  for (const id of ["a", "b"]) {
    b.subscribe(() => {
      if (b.open && b.isWaiting(id)) {
        swapped.push(id);
        b.done(id);
      }
    });
  }
  b.wait("a");
  b.wait("b");
  b.ready("a");
  assert.deepEqual(swapped, []);
  b.ready("b");
  assert.deepEqual(swapped.sort(), ["a", "b"]);
});

test("requestPair: shown stays, a new pair goes pending, going back drops it", () => {
  const A = { fg: "a", ref: "ra" };
  const B = { fg: "b", ref: "rb" };
  const C = { fg: "c", ref: null };
  let s = { shown: A, pending: null as typeof A | null };
  assert.equal(requestPair(s, { ...A }), s);
  s = requestPair(s, B);
  assert.deepEqual(s, { shown: A, pending: B });
  assert.equal(requestPair(s, { ...B }), s);
  s = requestPair(s, C);
  assert.deepEqual(s, { shown: A, pending: C });
  s = requestPair(s, A);
  assert.deepEqual(s, { shown: A, pending: null });
  assert.notEqual(pairKey({ fg: "a", ref: null }), pairKey({ fg: "a", ref: "" + "x" }));
});

test("slotElements: shown visible, pending hidden, a shared hash once", () => {
  assert.deepEqual(slotElements("a", null), [{ hash: "a", visible: true }]);
  assert.deepEqual(slotElements("a", "b"), [{ hash: "a", visible: true }, { hash: "b", visible: false }]);
  assert.deepEqual(slotElements("a", "a"), [{ hash: "a", visible: true }]);
  assert.deepEqual(slotElements(null, "b"), [{ hash: "b", visible: false }]);
  assert.deepEqual(slotElements(null, null), []);
});

test("FrameLock: a pair a frame apart for long resyncs (both) once, then cools down", () => {
  const d = 1 / 30;
  const lock = new FrameLock({ persist: 4, cooldown: 1 });
  const resyncs: string[][] = [];
  for (let k = 0; k < 30; k++) {
    // "b" presents one frame ahead of "a", every frame.
    for (const r of [lock.presented("a", "c", k * d, k * d, true), lock.presented("b", "c", (k + 1) * d, k * d, true)]) if (r) resyncs.push(r.sort());
  }
  assert.deepEqual(resyncs, [["a", "b"]], "1 s out of phase: one resync of both, then the cooldown");
});

test("FrameLock: callbacks of one vsync arriving apart, or at other vsyncs, are no mismatch", () => {
  const d = 1 / 30;
  const lock = new FrameLock({ persist: 2 });
  let resyncs = 0;
  for (let k = 1; k < 100; k++) {
    if (lock.presented("a", "c", k * d, k * d, true)) resyncs++;
    if (lock.presented("b", "c", k * d, k * d, true)) resyncs++;
    // Half a frame out of phase in when frames change, never in which frame is shown when compared.
    if (lock.presented("x", "c2", k * d, k * d, true)) resyncs++;
    if (lock.presented("y", "c2", k * d, k * d + d / 2, true)) resyncs++;
  }
  assert.equal(resyncs, 0);
});

test("FrameLock: other clocks, other frame rates and stopped videos are not compared", () => {
  const d = 1 / 30;
  const lock = new FrameLock({ persist: 2 });
  let resyncs = 0;
  for (let k = 1; k < 60; k++) {
    // Same frames apart, but on two clocks (panes playing on their own).
    if (lock.presented("a", "c1", k * d, k * d, true)) resyncs++;
    if (lock.presented("b", "c2", (k + 3) * d, k * d, true)) resyncs++;
    // A 25 fps clip on the same clock.
    if (lock.presented("p", "c1", Math.floor((k * d) / 0.04) * 0.04 + 0.04 * (k % 2), k * d, true)) resyncs++;
  }
  // "s" stopped long ago (a clip resting on its last frame).
  lock.presented("s", "c1", 0.5, 0, true);
  for (let k = 60; k < 90; k++) if (lock.presented("a", "c1", k * d, k * d, true)) resyncs++;
  assert.equal(resyncs, 0);
});

test("FrameLock: paused, or with one video, nothing to resync", () => {
  const d = 1 / 30;
  const lock = new FrameLock({ persist: 1 });
  for (let k = 0; k < 10; k++) {
    assert.equal(lock.presented("a", "c", k * d, k * d, false), null);
    assert.equal(lock.presented("b", "c", (k + 1) * d, k * d, false), null);
  }
  lock.remove("b");
  assert.equal(lock.presented("a", "c", 11 * d, 11 * d, true), null);
});
