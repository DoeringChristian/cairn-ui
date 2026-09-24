/**
 * Pure pieces of the live-updates poller.
 *
 * These three are the whole contract with the server: which runs get polled,
 * how the cursor walks forward across `more` pages, and how a delta point is
 * merged into a cached sequence without duplicating or reordering anything.
 *
 * Run: `npm run test:unit` (node --experimental-strip-types --test).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceCursor,
  appendAllDedup,
  appendDedup,
  getRunCursor,
  groupPointsBySeries,
  noteRunEpoch,
  resetRunCursor,
  resetRunCursors,
  seedRunEpoch,
  seedRunCursor,
  selectRunsToPoll,
  seriesKeyOfQueryKey,
  setRunCursor,
  shouldPollRun,
} from "./live-updates-core.ts";

type Pt = {
  step: number;
  wall_time: string;
  scalar_value: number | null;
  artifact_hash: string | null;
  object_type: string;
};

function pt(step: number): Pt {
  return {
    step,
    wall_time: `t${step}`,
    scalar_value: step,
    artifact_hash: null,
    object_type: "scalar",
  };
}

function upd(step: number, name = "loss") {
  return { ...pt(step), name };
}

// ---------------------------------------------------------------------------
// appendDedup
// ---------------------------------------------------------------------------

test("appendDedup appends a strictly newer step", () => {
  const points = [pt(0), pt(1)];
  const next = appendDedup(points, upd(2));
  assert.deepEqual(next.map((p) => p.step), [0, 1, 2]);
  assert.notEqual(next, points, "must not mutate in place");
  assert.deepEqual(points.map((p) => p.step), [0, 1]);
});

test("appendDedup strips the routing field from the stored point", () => {
  const [stored] = appendDedup([], upd(0, "loss"));
  assert.ok(stored);
  assert.equal("name" in stored, false);
  assert.deepEqual(stored, pt(0));
});

test("appendDedup returns the SAME array for a duplicate step", () => {
  const points = [pt(0), pt(1), pt(2)];
  assert.equal(appendDedup(points, upd(2)), points);
  assert.equal(appendDedup(points, upd(0)), points);
  assert.equal(appendDedup(points, upd(1)), points);
});

test("appendDedup keeps points sorted when a delta arrives out of order", () => {
  const points = [pt(0), pt(2), pt(5)];
  assert.deepEqual(appendDedup(points, upd(3)).map((p) => p.step), [0, 2, 3, 5]);
  assert.deepEqual(appendDedup(points, upd(1)).map((p) => p.step), [0, 1, 2, 5]);
  // Before everything.
  assert.deepEqual(appendDedup(points, upd(-1)).map((p) => p.step), [-1, 0, 2, 5]);
});

test("appendAllDedup folds a batch and reports 'nothing new' by identity", () => {
  const points = [pt(0), pt(1)];
  assert.equal(appendAllDedup(points, [upd(0), upd(1)]), points);
  const grown = appendAllDedup(points, [upd(1), upd(2), upd(3)]);
  assert.deepEqual(grown.map((p) => p.step), [0, 1, 2, 3]);
  // A whole poll of already-known points must not churn the cache.
  assert.equal(appendAllDedup(grown, [upd(2), upd(3)]), grown);
});

// ---------------------------------------------------------------------------
// Run selection
// ---------------------------------------------------------------------------

const base = { runId: "r1", hasActiveSequenceObserver: true, status: "running", cursor: 10 };

test("shouldPollRun needs an active observer, a live status and a cursor", () => {
  assert.equal(shouldPollRun(base), true);
  assert.equal(shouldPollRun({ ...base, hasActiveSequenceObserver: false }), false);
  assert.equal(shouldPollRun({ ...base, cursor: undefined }), false);
  assert.equal(shouldPollRun({ ...base, status: "completed" }), false);
  assert.equal(shouldPollRun({ ...base, status: "failed" }), false);
  assert.equal(shouldPollRun({ ...base, runId: "" }), false);
});

test("shouldPollRun treats an unknown status as live", () => {
  // The run-detail query may simply not have landed yet; the first /updates
  // response settles it.
  assert.equal(shouldPollRun({ ...base, status: null }), true);
  assert.equal(shouldPollRun({ ...base, status: undefined }), true);
});

test("shouldPollRun still requires a cursor when the status is unknown", () => {
  assert.equal(shouldPollRun({ ...base, status: null, cursor: undefined }), false);
});

test("a cursor of 0 is a real cursor, not a missing one", () => {
  assert.equal(shouldPollRun({ ...base, cursor: 0 }), true);
});

test("selectRunsToPoll keeps only the pollable ids", () => {
  assert.deepEqual(
    selectRunsToPoll([
      base,
      { ...base, runId: "r2", status: "completed" },
      { ...base, runId: "r3", cursor: undefined },
      { ...base, runId: "r4", hasActiveSequenceObserver: false },
      { ...base, runId: "r5", status: null },
    ]),
    ["r1", "r5"],
  );
});

// ---------------------------------------------------------------------------
// Cursor advancement + paging
// ---------------------------------------------------------------------------

test("advanceCursor moves forward and stops when there is no more", () => {
  assert.deepEqual(advanceCursor(10, { cursor: 42, more: false }), {
    cursor: 42,
    done: true,
  });
});

test("advanceCursor keeps paging while `more` is set", () => {
  assert.deepEqual(advanceCursor(10, { cursor: 5010, more: true }), {
    cursor: 5010,
    done: false,
  });
});

test("advanceCursor never rewinds on an empty or stale response", () => {
  assert.deepEqual(advanceCursor(42, { cursor: 42, more: false }), {
    cursor: 42,
    done: true,
  });
  assert.deepEqual(advanceCursor(42, { cursor: 7, more: false }), {
    cursor: 42,
    done: true,
  });
});

test("paging drains a run across `more` responses", () => {
  const pages = [
    { cursor: 5000, more: true },
    { cursor: 10000, more: true },
    { cursor: 10400, more: false },
  ];
  let cursor = 0;
  const requested: number[] = [];
  for (const page of pages) {
    requested.push(cursor);
    const step = advanceCursor(cursor, page);
    cursor = step.cursor;
    if (step.done) break;
  }
  assert.deepEqual(requested, [0, 5000, 10000]);
  assert.equal(cursor, 10400);
});

// ---------------------------------------------------------------------------
// Cursor map
// ---------------------------------------------------------------------------

test("the cursor map seeds once and then only advances", () => {
  resetRunCursors();
  assert.equal(getRunCursor("r1"), undefined);

  seedRunCursor("r1", 100);
  assert.equal(getRunCursor("r1"), 100);

  // A sequence read landing later must NOT move the cursor: its max rowid is
  // for its own series only, and adopting it would skip other series' rows.
  seedRunCursor("r1", 150);
  seedRunCursor("r1", 20);
  assert.equal(getRunCursor("r1"), 100);

  // The poller owns it from here, monotonically.
  setRunCursor("r1", 120);
  setRunCursor("r1", 110);
  assert.equal(getRunCursor("r1"), 120);

  // Keyed per run.
  assert.equal(getRunCursor("r2"), undefined);
  resetRunCursors();
});

test("a data-epoch change is reported once and the cursor can be dropped", () => {
  resetRunCursors();
  seedRunCursor("r1", 500);
  seedRunEpoch("r1", 0);
  seedRunEpoch("r1", 3); // a later read never overrides the first sighting
  assert.equal(noteRunEpoch("r1", 0), false);
  assert.equal(noteRunEpoch("r1", 1), true); // rewound
  assert.equal(noteRunEpoch("r1", 1), false); // reported once

  // setRunCursor can't move backwards, so a rewound run's cursor is dropped
  // and re-seeded from the refetched sequences.
  resetRunCursor("r1");
  assert.equal(getRunCursor("r1"), undefined);
  seedRunCursor("r1", 40);
  assert.equal(getRunCursor("r1"), 40);

  // An unseen run just records its epoch.
  assert.equal(noteRunEpoch("r2", 4), false);
  assert.equal(noteRunEpoch("r2", undefined), false);
  assert.equal(noteRunEpoch("r2", 4), false);
  resetRunCursors();
});

// ---------------------------------------------------------------------------
// Query-key routing
// ---------------------------------------------------------------------------

test("a plain sequence key routes to its series name", () => {
  assert.equal(seriesKeyOfQueryKey(["sequence", "r1", "loss"]), "loss");
});

test("a key with an extra slot never matches a real point", () => {
  assert.equal(seriesKeyOfQueryKey(["sequence", "r1", "loss", "last-summary"]), null);
  assert.equal(seriesKeyOfQueryKey(["sequence", "r1", 42]), null);
});

test("groupPointsBySeries splits a poll by name", () => {
  const grouped = groupPointsBySeries([
    upd(0, "loss"),
    upd(1, "loss"),
    upd(0, "acc"),
  ]);
  assert.deepEqual([...grouped.keys()].sort(), ["acc", "loss"]);
  assert.deepEqual(grouped.get("loss")!.map((p) => p.step), [0, 1]);
  assert.equal(grouped.get("acc")!.length, 1);
});
