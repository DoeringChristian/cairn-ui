import { test } from "node:test";
import assert from "node:assert/strict";
import type { GroupGraph, GroupGraphRun } from "./graph.ts";
import { fits, latestPicks, nameOrder, pickRun, resolvePicks, usedRuns } from "./picks.ts";

let clock = 0;
/** Runs are created in call order (each one newer than the last). */
function run(id: string, name: string, version: number): GroupGraphRun {
  clock += 1;
  return {
    id,
    name,
    display_name: name,
    version,
    status: "completed",
    created_at: `2026-01-01T00:00:${String(clock).padStart(2, "0")}Z`,
    ended_at: null,
  };
}
const graph = (runs: GroupGraphRun[], edges: Array<[string, string]> = []): GroupGraph => ({
  group: "exp",
  runs,
  edges: edges.map(([from, to]) => ({ from, to, via: "artifact" as const })),
});

// prepare v1 → train v1 → eval v1; prepare v2 → train v2 (eval not run on it).
const pipeline = () =>
  graph(
    [run("p1", "prepare", 1), run("t1", "train", 1), run("e1", "eval", 1), run("p2", "prepare", 2), run("t2", "train", 2)],
    [["p1", "t1"], ["t1", "e1"], ["p2", "t2"]],
  );

test("names: upstream to downstream, ties by first run", () => {
  const g = graph([run("e1", "eval", 1), run("x1", "extra", 1), run("t1", "train", 1)], [["t1", "e1"]]);
  assert.deepEqual(nameOrder(g), ["n:extra", "n:train", "n:eval"]);
});

test("latest picks: names without a fitting run are null", () => {
  assert.deepEqual(latestPicks(pipeline()), { "n:prepare": "p2", "n:train": "t2", "n:eval": null });
});

test("picking a downstream run pulls its upstream along", () => {
  const g = pipeline();
  const next = pickRun(g, latestPicks(g), "n:eval", "e1");
  assert.deepEqual(next, { "n:prepare": "p1", "n:train": "t1", "n:eval": "e1" });
});

test("pulling upstream keeps the current pick when the run used several versions", () => {
  const g = graph(
    [run("a1", "prep", 1), run("a2", "prep", 2), run("a3", "prep", 3), run("m1", "merge", 1)],
    [["a1", "m1"], ["a2", "m1"]],
  );
  assert.equal(pickRun(g, { "n:prep": "a1", "n:merge": null }, "n:merge", "m1")["n:prep"], "a1");
  // Not among them: the newest of the ones it used.
  assert.equal(pickRun(g, { "n:prep": "a3", "n:merge": null }, "n:merge", "m1")["n:prep"], "a2");
});

test("picking an upstream run re-checks downstream: a misfit becomes the newest fitting, else not run", () => {
  const g = pipeline();
  const all1 = { "n:prepare": "p1", "n:train": "t1", "n:eval": "e1" };
  // prepare v2: train v1 used prepare v1 → train v2; eval v1 used train v1 → nothing fits.
  assert.deepEqual(pickRun(g, all1, "n:prepare", "p2"), { "n:prepare": "p2", "n:train": "t2", "n:eval": null });
});

test("picking an upstream run fills a downstream name not run yet when a version fits", () => {
  const g = pipeline();
  assert.deepEqual(pickRun(g, latestPicks(g), "n:train", "t1"), { "n:prepare": "p1", "n:train": "t1", "n:eval": "e1" });
});

test("a pick that still fits stays even when a newer one would too", () => {
  const g = graph([run("t1", "train", 1), run("e1", "eval", 1), run("e2", "eval", 2)], [["t1", "e1"], ["t1", "e2"]]);
  assert.deepEqual(pickRun(g, { "n:train": "t1", "n:eval": "e1" }, "n:train", "t1"), { "n:train": "t1", "n:eval": "e1" });
});

test("fits: a candidate must match picked upstream and picked downstream", () => {
  const g = pipeline();
  assert.equal(fits(g, { "n:train": "t1" }, "n:eval", "e1"), true);
  assert.equal(fits(g, { "n:train": "t2" }, "n:eval", "e1"), false);
  assert.equal(fits(g, { "n:train": "t1" }, "n:prepare", "p2"), false);
  assert.equal(fits(g, { "n:train": null }, "n:prepare", "p2"), true);
});

test("resolve: stored picks keep, gone picks and new names take the newest fitting", () => {
  const g = pipeline();
  assert.deepEqual(resolvePicks(g, { "n:train": "t1", "n:eval": "gone" }), {
    "n:prepare": "p1",
    "n:train": "t1",
    "n:eval": "e1",
  });
  assert.deepEqual(resolvePicks(g, { "n:train": "t2", "n:eval": null }), { "n:prepare": "p2", "n:train": "t2", "n:eval": null });
});

test("used runs: what a run used inside the group", () => {
  assert.deepEqual(usedRuns(pipeline(), "t2").map((r) => r.id), ["p2"]);
  assert.deepEqual(usedRuns(pipeline(), "p1"), []);
});
