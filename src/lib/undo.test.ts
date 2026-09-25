import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGE_WINDOW_MS, UNDO_CAP, UndoStack } from "./undo.ts";

/** A value with an undo stack editing it, on a controllable clock. */
function harness() {
  let t = 0;
  const stack = new UndoStack(() => t);
  const state = { v: 0 };
  const set = (next: number, mergeKey?: string) => {
    const prev = state.v;
    state.v = next;
    stack.push({ label: `set ${next}`, undo: () => (state.v = prev), redo: () => (state.v = next), mergeKey });
  };
  return { stack, state, set, advance: (ms: number) => (t += ms) };
}

test("undo and redo restore values in order", () => {
  const h = harness();
  h.set(1);
  h.set(2);
  assert.equal(h.stack.undo(), "set 2");
  assert.equal(h.state.v, 1);
  h.stack.undo();
  assert.equal(h.state.v, 0);
  assert.equal(h.stack.undo(), null);
  h.stack.redo();
  h.stack.redo();
  assert.equal(h.state.v, 2);
  assert.equal(h.stack.redo(), null);
});

test("same mergeKey within the window coalesces into one entry", () => {
  const h = harness();
  h.set(1, "smoothing");
  h.advance(100);
  h.set(2, "smoothing");
  h.advance(MERGE_WINDOW_MS);
  h.set(3, "smoothing");
  assert.equal(h.stack.size, 1);
  h.stack.undo();
  assert.equal(h.state.v, 0, "undo returns to the value before the drag");
  h.stack.redo();
  assert.equal(h.state.v, 3, "redo lands on the latest value");
});

test("merging is measured from the latest push, and expires", () => {
  const h = harness();
  h.set(1, "k");
  h.advance(MERGE_WINDOW_MS + 1);
  h.set(2, "k");
  assert.equal(h.stack.size, 2);
});

test("different or absent merge keys never coalesce", () => {
  const h = harness();
  h.set(1, "a");
  h.set(2, "b");
  h.set(3);
  h.set(4);
  assert.equal(h.stack.size, 4);
});

test("a push invalidates redo", () => {
  const h = harness();
  h.set(1);
  h.set(2);
  h.stack.undo();
  assert.ok(h.stack.canRedo);
  h.set(5);
  assert.ok(!h.stack.canRedo);
  assert.equal(h.stack.redo(), null);
  h.stack.undo();
  assert.equal(h.state.v, 1);
});

test("a push after undo never merges into the redone entry", () => {
  const h = harness();
  h.set(1, "k");
  h.stack.undo();
  h.stack.redo();
  h.set(2, "k");
  assert.equal(h.stack.size, 2);
});

test("the stack keeps at most UNDO_CAP entries, dropping the oldest", () => {
  const h = harness();
  for (let i = 1; i <= UNDO_CAP + 5; i++) h.set(i);
  assert.equal(h.stack.size, UNDO_CAP);
  while (h.stack.undo() !== null);
  assert.equal(h.state.v, 5, "the five oldest edits can no longer be undone");
});

test("subscribers are notified and the version bumps", () => {
  const h = harness();
  let calls = 0;
  const off = h.stack.subscribe(() => calls++);
  const v0 = h.stack.getVersion();
  h.set(1);
  h.stack.undo();
  h.stack.redo();
  assert.equal(calls, 3);
  assert.equal(h.stack.getVersion(), v0 + 3);
  off();
  h.set(2);
  assert.equal(calls, 3);
});

test("labels", () => {
  const h = harness();
  assert.equal(h.stack.undoLabel, null);
  h.set(7);
  assert.equal(h.stack.undoLabel, "set 7");
  h.stack.undo();
  assert.equal(h.stack.redoLabel, "set 7");
});
