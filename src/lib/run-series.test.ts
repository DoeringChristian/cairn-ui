import { test } from "node:test";
import assert from "node:assert/strict";
import { bySeries, newerInSeries, newestOfSeries, olderInSeries, runSeriesKey } from "./run-series.ts";
import { makeRun as run } from "./runs-table/test-run.ts";

test("runSeriesKey: (group, job_type, name); the same name in two groups is two series; unnamed runs are their own", () => {
  const a = run("a", { display_name: "train", group: "exp-44" });
  const b = run("b", { display_name: "train", group: "exp-43" });
  const c = run("c", { display_name: "train", group: "exp-44" });
  assert.notEqual(runSeriesKey(a), runSeriesKey(b));
  assert.equal(runSeriesKey(a), runSeriesKey(c));
  assert.notEqual(runSeriesKey(run("x", { display_name: null })), runSeriesKey(run("y", { display_name: null })));
  assert.notEqual(runSeriesKey(run("u", { display_name: "train" })), runSeriesKey(a));
  assert.deepEqual([...bySeries([a, b, c]).values()].map((l) => l.map((r) => r.id)), [["a", "c"], ["b"]]);
});

test("newerInSeries: the version first, else created_at", () => {
  assert.equal(newerInSeries({ version: 2, created_at: "2026-01-01" }, { version: 1, created_at: "2026-01-09" }), true);
  assert.equal(newerInSeries({ version: null, created_at: "2026-01-02" }, { version: 3, created_at: "2026-01-01" }), true);
});

test("olderInSeries ('Archive / Delete old'): every run but its series' newest, per group", () => {
  const rs = [
    run("t44v1", { display_name: "train", group: "exp-44", version: 1, created_at: "2026-01-01" }),
    run("t44v2", { display_name: "train", group: "exp-44", version: 2, created_at: "2026-01-02" }),
    run("t43v1", { display_name: "train", group: "exp-43", version: 1, created_at: "2026-01-03" }),
    run("solo", { display_name: "train", created_at: "2026-01-04" }),
  ];
  assert.deepEqual(olderInSeries(rs).map((r) => r.id), ["t44v1"]);
  assert.deepEqual(newestOfSeries(rs).map((r) => r.id), ["t44v2", "t43v1", "solo"]);
});

test("runSeriesKey: the job type is part of the key (fine-tune siblings, re-runs)", () => {
  const ft4 = run("ft4", { display_name: "ft-lr1e-4", group: "exp-44", job_type: "finetune", version: 1, created_at: "2026-01-01" });
  const ft5 = run("ft5", { display_name: "ft-lr1e-5", group: "exp-44", job_type: "finetune", version: 1, created_at: "2026-01-02" });
  const ft4b = run("ft4b", { display_name: "ft-lr1e-4", group: "exp-44", job_type: "finetune", version: 2, created_at: "2026-01-03" });
  const ev = run("ev", { display_name: "ft-lr1e-4", group: "exp-44", job_type: "eval", version: 1, created_at: "2026-01-04" });
  const none = run("none", { display_name: "ft-lr1e-4", group: "exp-44", version: 1, created_at: "2026-01-05" });
  assert.equal(runSeriesKey(ft4), runSeriesKey(ft4b));
  assert.notEqual(runSeriesKey(ft4), runSeriesKey(ft5));
  assert.notEqual(runSeriesKey(ft4), runSeriesKey(ev));
  assert.notEqual(runSeriesKey(ft4), runSeriesKey(none));
  const rs = [ft4, ft5, ft4b, ev, none];
  assert.deepEqual(newestOfSeries(rs).map((r) => r.id), ["ft4b", "ft5", "ev", "none"]);
  assert.deepEqual(olderInSeries(rs).map((r) => r.id), ["ft4"]);
});
