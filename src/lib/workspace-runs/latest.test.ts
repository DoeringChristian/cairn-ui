import { test } from "node:test";
import assert from "node:assert/strict";
import type { GroupGraph, GroupGraphRun } from "./graph.ts";
import { latestRuns } from "./latest.ts";
let clock = 0;
/** Runs are created in call order (each one newer than the last). */
function run(id: string, name: string | null, version: number | null, status: GroupGraphRun["status"] = "completed"): GroupGraphRun {
  clock += 1;
  return {
    id,
    name,
    display_name: name,
    version,
    status,
    created_at: `2026-01-01T00:00:${String(clock).padStart(2, "0")}Z`,
    ended_at: null,
  };
}
const edge = (from: string, to: string) => ({ from, to, via: "artifact" as const });
const graph = (runs: GroupGraphRun[], edges: Array<[string, string]> = []): GroupGraph => ({
  group: "exp",
  runs,
  edges: edges.map(([a, b]) => edge(a, b)),
});
const sorted = (xs: string[]) => [...xs].sort();

// --- latestRuns -------------------------------------------------------------

test("latest: a newer upstream version leaves the downstream name not run yet", () => {
  const g = graph([run("t1", "train", 1), run("e1", "eval", 1), run("t2", "train", 2)], [["t1", "e1"]]);
  assert.deepEqual(latestRuns(g), { runIds: ["t2"], notRun: ["n:eval"] });
});

test("latest: a newer downstream version not using the upstream still pairs with the newest upstream", () => {
  const g = graph([run("t1", "train", 1), run("e1", "eval", 1), run("e2", "eval", 2)], [["t1", "e1"]]);
  const r = latestRuns(g);
  assert.deepEqual(sorted(r.runIds), ["e2", "t1"]);
  assert.deepEqual(r.notRun, []);
});

test("latest: two consistent pairs pick the newer pair", () => {
  const g = graph(
    [run("t1", "train", 1), run("e1", "eval", 1), run("t2", "train", 2), run("e2", "eval", 2)],
    [["t1", "e1"], ["t2", "e2"]],
  );
  assert.deepEqual(sorted(latestRuns(g).runIds), ["e2", "t2"]);
});

test("latest: the newest run's name goes first, then older versions are searched for a fit", () => {
  // eval v2 used train v1; train v2 is newer than eval v1 but older than eval v2.
  const g = graph(
    [run("t1", "train", 1), run("e1", "eval", 1), run("t2", "train", 2), run("e2", "eval", 2)],
    [["t1", "e1"], ["t1", "e2"]],
  );
  assert.deepEqual(latestRuns(g), { runIds: ["e2", "t1"], notRun: [] });
});

test("latest: a downstream that used several versions of a name accepts any of them", () => {
  const g = graph([run("a1", "prep", 1), run("a2", "prep", 2), run("m1", "merge", 1)], [["a1", "m1"], ["a2", "m1"]]);
  assert.deepEqual(sorted(latestRuns(g).runIds), ["a2", "m1"]);
});

test("latest: unnamed runs are each their own name", () => {
  const g = graph([run("x", null, null), run("y", null, null), run("t1", "train", 1)]);
  const r = latestRuns(g);
  assert.deepEqual(sorted(r.runIds), ["t1", "x", "y"]);
  assert.deepEqual(r.notRun, []);
});

test("latest: an empty group selects nothing", () => {
  assert.deepEqual(latestRuns(graph([])), { runIds: [], notRun: [] });
});

test("latest: a running run counts as the newest", () => {
  const g = graph([run("t1", "train", 1), run("e1", "eval", 1), run("t2", "train", 2, "running")], [["t1", "e1"]]);
  assert.deepEqual(latestRuns(g), { runIds: ["t2"], notRun: ["n:eval"] });
});

