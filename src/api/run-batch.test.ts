import assert from "node:assert/strict";
import test from "node:test";

import { RunBatcher, planBatches, type RunPart, type RunsBatchResponse } from "./run-batch.ts";

test("planBatches groups runs by the parts asked for, in chunks", () => {
  const asked = new Map<string, Set<RunPart>>([
    ["a", new Set<RunPart>(["sequences", "run"])],
    ["b", new Set<RunPart>(["run"])],
    ["c", new Set<RunPart>(["run", "sequences"])],
    ["d", new Set<RunPart>(["outputs", "sequences", "run"])],
    ["e", new Set<RunPart>(["run", "sequences"])],
  ]);
  assert.deepEqual(planBatches(asked, 2), [
    { ids: ["a", "c"], include: ["run", "sequences"] },
    { ids: ["e"], include: ["run", "sequences"] },
    { ids: ["b"], include: ["run"] },
    { ids: ["d"], include: ["run", "sequences", "outputs"] },
  ]);
  assert.deepEqual(planBatches(new Map()), []);
});

function harness(respond: (ids: string[], include: RunPart[]) => RunsBatchResponse | Promise<RunsBatchResponse>, maxIds?: number) {
  const batches: Array<{ ids: string[]; include: RunPart[] }> = [];
  const singles: Array<{ id: string; part: RunPart }> = [];
  let flush: (() => void) | null = null;
  const b = new RunBatcher({
    fetchBatch: async (ids, include) => {
      batches.push({ ids, include });
      return respond(ids, include);
    },
    fetchOne: async (id, part) => {
      singles.push({ id, part });
      return { one: id, part };
    },
    error: (status, id, part) => new Error(`${status} ${id} ${part}`),
    schedule: (fn) => {
      flush = fn;
    },
    maxIds,
  });
  return { b, batches, singles, flush: () => flush?.() };
}

const answer = (ids: string[], include: RunPart[]): RunsBatchResponse => ({
  runs: Object.fromEntries(ids.map((id) => [id, Object.fromEntries(include.map((p) => [p, `${id}:${p}`]))])),
  missing: [],
  forbidden: [],
});

test("one task's runs share one request per chunk; each load gets its own part", async () => {
  const h = harness(answer, 2);
  const loads = [
    h.b.load("a", "run"),
    h.b.load("a", "sequences"),
    h.b.load("b", "run"),
    h.b.load("b", "sequences"),
    h.b.load("c", "run"),
    h.b.load("c", "sequences"),
    h.b.load("a", "run"), // asked twice: one read
  ];
  h.flush();
  assert.deepEqual(await Promise.all(loads), ["a:run", "a:sequences", "b:run", "b:sequences", "c:run", "c:sequences", "a:run"]);
  assert.deepEqual(h.batches, [
    { ids: ["a", "b"], include: ["run", "sequences"] },
    { ids: ["c"], include: ["run", "sequences"] },
  ]);
  assert.deepEqual(h.singles, []);
});

test("a task about one run alone uses its per-run routes", async () => {
  const h = harness(answer);
  const loads = [h.b.load("a", "run"), h.b.load("a", "outputs")];
  h.flush();
  assert.deepEqual(await Promise.all(loads), [{ one: "a", part: "run" }, { one: "a", part: "outputs" }]);
  assert.deepEqual(h.batches, []);
  assert.deepEqual(h.singles, [{ id: "a", part: "run" }, { id: "a", part: "outputs" }]);
});

test("missing and forbidden runs reject with their status; the rest resolve", async () => {
  const h = harness((ids, include) => {
    const r = answer(ids.filter((id) => id === "ok"), include);
    return { ...r, missing: ["gone"], forbidden: ["theirs"] };
  });
  const ok = h.b.load("ok", "run");
  const gone = h.b.load("gone", "run");
  const theirs = h.b.load("theirs", "sequences");
  h.flush();
  assert.equal(await ok, "ok:run");
  await assert.rejects(gone, /404 gone run/);
  await assert.rejects(theirs, /403 theirs sequences/);
});

test("a failed request rejects every load it carried, and only those", async () => {
  const h = harness((ids, include) => {
    if (include.includes("outputs")) throw new Error("boom");
    return answer(ids, include);
  });
  const run = [h.b.load("a", "run"), h.b.load("b", "run")];
  const outs = [h.b.load("c", "outputs"), h.b.load("d", "outputs")];
  h.flush();
  assert.deepEqual(await Promise.all(run), ["a:run", "b:run"]);
  for (const o of outs) await assert.rejects(o, /boom/);
});

test("loads after a flush start the next batch", async () => {
  const h = harness(answer);
  const first = [h.b.load("a", "run"), h.b.load("b", "run")];
  h.flush();
  const second = [h.b.load("c", "run"), h.b.load("d", "run")];
  h.flush();
  assert.deepEqual(await Promise.all([...first, ...second]), ["a:run", "b:run", "c:run", "d:run"]);
  assert.deepEqual(h.batches.map((b) => b.ids), [["a", "b"], ["c", "d"]]);
});
