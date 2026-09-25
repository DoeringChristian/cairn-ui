import { test } from "node:test";
import assert from "node:assert/strict";
import { SharedClock, driftCorrection, formatClock, mediaTargetTime } from "./shared-clock.ts";

function fake() {
  let t = 100;
  const clock = new SharedClock(() => t);
  return { clock, advance: (s: number) => { t += s; } };
}

test("the clock advances only while playing", () => {
  const { clock, advance } = fake();
  assert.equal(clock.position(), 0);
  advance(5);
  assert.equal(clock.position(), 0);
  clock.play();
  advance(2);
  assert.equal(clock.position(), 2);
  clock.pause();
  advance(3);
  assert.equal(clock.position(), 2);
});

test("seek, rate and a duration clamp", () => {
  const { clock, advance } = fake();
  clock.setDuration("a", 10);
  clock.setDuration("b", 4);
  assert.equal(clock.duration, 10);
  clock.seek(3);
  assert.equal(clock.position(), 3);
  clock.seek(99);
  assert.equal(clock.position(), 10);
  clock.seek(-1);
  assert.equal(clock.position(), 0);
  clock.setRate(2);
  clock.play();
  advance(1.5);
  assert.equal(clock.position(), 3);
});

test("without loop the clock stops at the end; play restarts from zero", () => {
  const { clock, advance } = fake();
  clock.setDuration("a", 5);
  clock.play();
  advance(7);
  assert.equal(clock.position(), 5);
  clock.tick();
  assert.equal(clock.playing, false);
  assert.equal(clock.position(), 5);
  clock.play();
  assert.equal(clock.position(), 0);
});

test("with loop the clock wraps and keeps playing", () => {
  const { clock, advance } = fake();
  clock.setDuration("a", 4);
  clock.setLoop(true);
  clock.play();
  advance(9);
  clock.tick();
  assert.equal(clock.playing, true);
  assert.equal(clock.position(), 1);
});

test("dropping durations and subscribers", () => {
  const { clock } = fake();
  let calls = 0;
  const off = clock.subscribe(() => calls++);
  clock.setDuration("a", 3);
  clock.setDuration("a", 3); // unchanged: no event
  clock.setDuration("a", null);
  assert.equal(clock.duration, 0);
  assert.equal(calls, 2);
  off();
  clock.play();
  assert.equal(calls, 2);
});

test("drift: small drifts nudge the rate toward the clock", () => {
  const behind = driftCorrection(1.9, 2.0, true, 1);
  assert.equal(behind.kind, "rate");
  assert.ok(behind.rate > 1, "a lagging element speeds up");
  const ahead = driftCorrection(2.1, 2.0, true, 1);
  assert.equal(ahead.kind, "rate");
  assert.ok(ahead.rate < 1, "a leading element slows down");
  assert.ok(Math.abs(ahead.rate - 0.95) < 1e-9);
});

test("drift: the nudge is capped and scales with the clock's rate", () => {
  const a = driftCorrection(1.75, 2.0, true, 2, { seekAbove: 1, maxNudge: 0.1, gain: 1 });
  assert.equal(a.kind, "rate");
  assert.ok(Math.abs(a.rate - 2.2) < 1e-9);
});

test("drift: large drifts seek; within tolerance nothing changes", () => {
  assert.deepEqual(driftCorrection(0, 2, true, 1), { kind: "seek", to: 2, rate: 1 });
  assert.deepEqual(driftCorrection(2.01, 2, true, 1), { kind: "none", rate: 1 });
});

test("drift: a paused element seeks to the clock unless within tolerance", () => {
  assert.deepEqual(driftCorrection(1, 2, false, 1), { kind: "seek", to: 2, rate: 1 });
  assert.deepEqual(driftCorrection(1.99, 2, false, 1), { kind: "none", rate: 1 });
});

test("simulated playback converges: a lagging element catches up by rate nudges", () => {
  const { clock, advance } = fake();
  clock.play();
  let media = 0;
  let mediaRate = 1;
  // The element starts 0.2 s behind (a slow decoder start).
  clock.seek(0.2);
  for (let i = 0; i < 200; i++) {
    const action = driftCorrection(media, clock.position(), clock.playing, clock.rate);
    if (action.kind === "seek") media = action.to;
    mediaRate = action.rate;
    advance(1 / 60);
    media += mediaRate / 60;
  }
  assert.ok(Math.abs(media - clock.position()) <= 0.04 + 1e-9, `drift ${media - clock.position()}`);
});

test("a shorter clip rests on its last frame", () => {
  assert.equal(mediaTargetTime(8, 5), 5);
  assert.equal(mediaTargetTime(3, 5), 3);
  assert.equal(mediaTargetTime(3, Number.NaN), 3);
});

test("formatClock", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(65.4), "1:05");
  assert.equal(formatClock(3725), "1:02:05");
});
