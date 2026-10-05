/** Snapshot turns for paused viewer frames. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { CaptureQueue } from "./capture-queue.ts";

function harness(concurrency = 1) {
  const q = new CaptureQueue(concurrency);
  const started: string[] = [];
  const dones = new Map<string, () => void>();
  const req = (id: string, priority = 0) => q.request(id, (done) => { started.push(id); dones.set(id, done); }, priority);
  return { q, started, dones, req };
}

test("one turn at a time, in request order", () => {
  const h = harness();
  h.req("a"); h.req("b"); h.req("c");
  assert.deepEqual(h.started, ["a"]);
  h.dones.get("a")!();
  assert.deepEqual(h.started, ["a", "b"]);
  h.dones.get("a")!(); // a second done is ignored
  assert.deepEqual(h.started, ["a", "b"]);
  h.dones.get("b")!();
  h.dones.get("c")!();
  assert.deepEqual(h.q.stats(), { waiting: 0, running: 0 });
});

test("on-screen frames (higher priority) go first", () => {
  const h = harness();
  h.req("busy");
  h.req("near", 1); h.req("visible", 2); h.req("near2", 1);
  h.dones.get("busy")!();
  assert.deepEqual(h.started, ["busy", "visible"]);
  h.dones.get("visible")!();
  assert.deepEqual(h.started, ["busy", "visible", "near"]);
});

test("cancel: a waiting turn is dropped, a running one ends", () => {
  const h = harness();
  const cancelA = h.req("a");
  const cancelB = h.req("b");
  h.req("c");
  cancelB();
  cancelA();
  assert.deepEqual(h.started, ["a", "c"]);
  assert.deepEqual(h.q.stats(), { waiting: 0, running: 1 });
});

test("a repeated request replaces the waiting one; concurrency is honoured", () => {
  const h = harness(2);
  h.req("x"); h.req("y"); h.req("z"); h.req("z", 5);
  assert.deepEqual(h.started, ["x", "y"]);
  h.dones.get("x")!();
  assert.deepEqual(h.started, ["x", "y", "z"]);
  assert.deepEqual(h.q.stats(), { waiting: 0, running: 2 });
});
