import assert from "node:assert/strict";
import test from "node:test";

import { SeriesBatcher, chunkNames, expandSeries, packRuns, DEFAULT_LIMITS, type SeriesBatchResponse, type SeriesManyResponse, type WireSeries } from "./series-batch.ts";

const wire = (name: string, steps: number[]): WireSeries => ({
  name,
  count: steps.length,
  cursor: steps.length ? 100 + steps.length : 0,
  columns: { step: steps, scalar_value: steps.map((s) => s / 2), wall_time: steps.map((s) => `t${s}`) },
  constant: { object_type: "scalar", artifact_hash: null, metadata: null, artifact_mime: null, artifact_size: null, artifact_metadata: null },
});

test("expandSeries restores the per-name endpoint's point objects", () => {
  const r = expandSeries("r1", wire("loss", [0, 5]), 3);
  assert.deepEqual(r, {
    run_id: "r1",
    name: "loss",
    cursor: 102,
    data_epoch: 3,
    points: [
      { step: 0, scalar_value: 0, wall_time: "t0", object_type: "scalar", artifact_hash: null, metadata: null, artifact_mime: null, artifact_size: null, artifact_metadata: null },
      { step: 5, scalar_value: 2.5, wall_time: "t5", object_type: "scalar", artifact_hash: null, metadata: null, artifact_mime: null, artifact_size: null, artifact_metadata: null },
    ],
  });
  assert.deepEqual(expandSeries("r1", wire("x", []), 0).points, []);
});

test("chunkNames respects the name, point and URL budgets", () => {
  const lim = { ...DEFAULT_LIMITS, maxNames: 3, maxPoints: 100, maxQueryChars: 1000 };
  assert.deepEqual(chunkNames(["a", "b", "c", "d"], () => 0, lim), [["a", "b", "c"], ["d"]]);
  assert.deepEqual(chunkNames(["a", "b", "c"], (n) => (n === "b" ? 90 : 20), lim), [["a"], ["b"], ["c"]]);
  // A series over the budget goes alone, never dropped.
  assert.deepEqual(chunkNames(["big", "s"], (n) => (n === "big" ? 1e6 : 1), lim), [["big"], ["s"]]);
  assert.deepEqual(chunkNames(["aaaa", "bbbb"], () => 0, { ...lim, maxQueryChars: 12 }), [["aaaa"], ["bbbb"]]);
  assert.deepEqual(chunkNames([], () => 0, lim), []);
});

function harness() {
  const calls: Array<{ runId: string; names: string[] }> = [];
  const pending: Array<() => void> = [];
  const b = new SeriesBatcher({
    fetchBatch: async (runId, names): Promise<SeriesBatchResponse> => {
      calls.push({ runId, names });
      return { run_id: runId, data_epoch: 1, cursor: 0, series: names.map((n) => wire(n, [1, 2])) };
    },
    schedule: (fn) => pending.push(fn),
    limits: { maxNames: 2, maxPoints: 1e9, maxQueryChars: 1e9 },
  });
  const flush = () => pending.splice(0).forEach((f) => f());
  return { b, calls, flush };
}

test("one task's loads become one request per run (chunked), duplicates shared", async () => {
  const { b, calls, flush } = harness();
  const ps = [b.load("r1", "a"), b.load("r1", "b"), b.load("r2", "a"), b.load("r1", "a"), b.load("r1", "c")];
  flush();
  const res = await Promise.all(ps);
  assert.deepEqual(calls, [
    { runId: "r1", names: ["a", "b"] },
    { runId: "r1", names: ["c"] },
    { runId: "r2", names: ["a"] },
  ]);
  assert.deepEqual(res.map((r) => `${r.run_id}/${r.name}`), ["r1/a", "r1/b", "r2/a", "r1/a", "r1/c"]);
  // Two waiters of one series get separate objects.
  assert.notEqual(res[0], res[3]);
  assert.deepEqual(res[0], res[3]);
});

test("a later task starts a new batch", async () => {
  const { b, calls, flush } = harness();
  const p1 = b.load("r1", "a");
  flush();
  await p1;
  const p2 = b.load("r1", "b");
  flush();
  await p2;
  assert.deepEqual(calls.map((c) => c.names), [["a"], ["b"]]);
});

test("a failed request rejects exactly its series", async () => {
  const pending: Array<() => void> = [];
  const b = new SeriesBatcher({
    fetchBatch: async (runId, names) => {
      if (runId === "bad") throw new Error("404");
      return { run_id: runId, data_epoch: 0, cursor: 0, series: names.map((n) => wire(n, [])) };
    },
    schedule: (fn) => pending.push(fn),
  });
  const ok = b.load("good", "a");
  const bad = b.load("bad", "a");
  pending.splice(0).forEach((f) => f());
  assert.equal((await ok).name, "a");
  await assert.rejects(bad, /404/);
});

test("packRuns: one run once per request, within the run, point and name budgets", () => {
  const c = (runId: string, names: string[], points = 0) => ({ runId, names, points });
  const lim = { ...DEFAULT_LIMITS, maxRuns: 2, maxPoints: 100, maxTotalNames: 4 };
  const ids = (reqs: ReturnType<typeof packRuns>) => reqs.map((r) => r.map((x) => `${x.runId}:${x.names.join("+")}`));
  assert.deepEqual(ids(packRuns([c("a", ["x"]), c("b", ["x"]), c("c", ["x"])], lim)), [["a:x", "b:x"], ["c:x"]]);
  // A run's second chunk goes to the next request.
  assert.deepEqual(ids(packRuns([c("a", ["x"]), c("a", ["y"]), c("b", ["x"])], lim)), [["a:x"], ["a:y", "b:x"]]);
  assert.deepEqual(ids(packRuns([c("a", ["x"], 60), c("b", ["x"], 60)], lim)), [["a:x"], ["b:x"]]);
  assert.deepEqual(ids(packRuns([c("a", ["x", "y", "z"]), c("b", ["x", "y"])], lim)), [["a:x+y+z"], ["b:x+y"]]);
  assert.deepEqual(ids(packRuns([c("a", ["x"], 1e6)], lim)), [["a:x"]]);
  assert.deepEqual(packRuns([], lim), []);
});

function manyHarness(respond?: (runs: Record<string, string[]>) => SeriesManyResponse) {
  const single: string[] = [];
  const many: Array<Record<string, string[]>> = [];
  const pending: Array<() => void> = [];
  const body = (runId: string, names: string[]): SeriesBatchResponse => ({ run_id: runId, data_epoch: 2, cursor: 0, series: names.map((n) => wire(n, [1])) });
  const b = new SeriesBatcher({
    fetchBatch: async (runId, names) => {
      single.push(runId);
      return body(runId, names);
    },
    fetchMany: async (runs) => {
      many.push(runs);
      if (respond) return respond(runs);
      return { runs: Object.fromEntries(Object.entries(runs).map(([id, names]) => [id, body(id, names)])), missing: [], forbidden: [] };
    },
    error: (status, runId) => new Error(`${status} ${runId}`),
    schedule: (fn) => pending.push(fn),
    limits: { maxRuns: 2 },
  });
  return { b, single, many, flush: () => pending.splice(0).forEach((f) => f()) };
}

test("several runs' loads share POST /api/runs/series requests; one run alone keeps its GET", async () => {
  const h = manyHarness();
  const ps = [h.b.load("r1", "a"), h.b.load("r2", "a"), h.b.load("r2", "b"), h.b.load("r3", "a")];
  h.flush();
  const res = await Promise.all(ps);
  assert.deepEqual(h.many, [{ r1: ["a"], r2: ["a", "b"] }, { r3: ["a"] }]);
  assert.deepEqual(h.single, []);
  assert.deepEqual(res.map((r) => `${r.run_id}/${r.name}/${r.data_epoch}`), ["r1/a/2", "r2/a/2", "r2/b/2", "r3/a/2"]);
  const lone = h.b.load("r9", "a");
  h.flush();
  assert.equal((await lone).run_id, "r9");
  assert.deepEqual(h.single, ["r9"]);
});

test("missing and forbidden runs reject with their status", async () => {
  const h = manyHarness((runs) => ({
    runs: { ok: { run_id: "ok", data_epoch: 0, cursor: 0, series: (runs.ok ?? []).map((n) => wire(n, [])) } },
    missing: ["gone"],
    forbidden: ["theirs"],
  }));
  const ps = [h.b.load("ok", "a"), h.b.load("gone", "a"), h.b.load("theirs", "a")];
  h.flush();
  assert.equal((await ps[0]!).name, "a");
  await assert.rejects(ps[1]!, /404 gone/);
  await assert.rejects(ps[2]!, /403 theirs/);
});
