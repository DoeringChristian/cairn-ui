import assert from "node:assert/strict";
import test from "node:test";

import { SeriesBatcher, chunkNames, expandSeries, type SeriesBatchResponse, type WireSeries } from "./series-batch.ts";

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
  const lim = { maxNames: 3, maxPoints: 100, maxQueryChars: 1000 };
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
