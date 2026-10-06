/**
 * The runs list's live poll: which runs it asks for, and when a poll can be
 * merged into the cached pages versus when the pages must be refetched.
 *
 * Run: `npm run test:unit` (node --experimental-strip-types --test).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mergeLiveRuns, runningIds, type RunsPages } from "./runs-live-core.ts";
import type { Run, RunsListResponse } from "./types";

function run(id: string, status = "completed", values: Record<string, unknown> = {}): Run {
  return { id, status, values } as unknown as Run;
}

function page(runs: Run[], offset: number, total: number): RunsListResponse {
  return { runs, total, limit: 2, offset } as RunsListResponse;
}

function data(): RunsPages {
  return {
    pages: [
      page([run("a", "running", { loss: 1 }), run("b")], 0, 4),
      page([run("c"), run("d", "running", { loss: 5 })], 2, 4),
    ],
    pageParams: [0, 2],
  };
}

const head = page([run("a", "running")], 0, 4);

test("runningIds lists running runs across every loaded page", () => {
  assert.deepEqual(runningIds(data().pages), ["a", "d"]);
  assert.deepEqual(runningIds(undefined), []);
});

test("a poll replaces just the polled rows, on every page", () => {
  const cached = data();
  const live = page([run("a", "running", { loss: 0.5 }), run("d", "completed", { loss: 4 })], 0, 2);
  const merged = mergeLiveRuns(cached, head, live, ["a", "d"]);
  assert.ok(merged);
  assert.deepEqual(merged.pages[0].runs[0].values, { loss: 0.5 });
  assert.equal(merged.pages[1].runs[1].status, "completed");
  // Untouched rows keep their identity (memoized renders), pages keep offsets.
  assert.equal(merged.pages[0].runs[1], cached.pages[0].runs[1]);
  assert.equal(merged.pages[1].runs[0], cached.pages[1].runs[0]);
  assert.equal(merged.pages[1].offset, 2);
  assert.equal(merged.pageParams, cached.pageParams);
});

test("a new or deleted run (head or total moved) refetches the pages", () => {
  const live = page([run("a", "running"), run("d", "running")], 0, 2);
  assert.equal(mergeLiveRuns(data(), page([run("z", "running")], 0, 5), live, ["a", "d"]), null);
  assert.equal(mergeLiveRuns(data(), page([run("a", "running")], 0, 3), live, ["a", "d"]), null);
});

test("a polled run missing from the answer refetches the pages", () => {
  const live = page([run("a", "running")], 0, 1);
  assert.equal(mergeLiveRuns(data(), head, live, ["a", "d"]), null);
});

test("with nothing running, the head alone notices a new run", () => {
  const done: RunsPages = { pages: [page([run("a"), run("b")], 0, 2)], pageParams: [0] };
  const empty = page([], 0, 0);
  assert.equal(mergeLiveRuns(done, page([run("a")], 0, 2), empty, []), done);
  assert.equal(mergeLiveRuns(done, page([run("n", "running")], 0, 3), empty, []), null);
});
