import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, aggregateGroups, asOf, centre, groupBy, groupSeries, unionGrid } from "./aggregate.ts";
import type { SeriesPoint } from "./types.ts";

const pts = (pairs: Array<[number, number]>): SeriesPoint[] => pairs.map(([x, y]) => ({ x, y }));
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("groupBy keeps first-seen order and sets null keys apart", () => {
  const { groups, ungrouped } = groupBy(["a1", "b1", "a2", "x"], (s) => (s === "x" ? null : s[0]!));
  assert.deepEqual(groups, [{ key: "a", members: ["a1", "a2"] }, { key: "b", members: ["b1"] }]);
  assert.deepEqual(ungrouped, ["x"]);
});

test("unionGrid is sorted and unique", () => {
  assert.deepEqual(unionGrid([pts([[2, 0], [0, 0]]), pts([[1, 0], [2, 0]])]), [0, 1, 2]);
});

test("asOf holds the last value and stays inside the member's range", () => {
  const grid = [0, 1, 2, 3, 4, 5];
  assert.deepEqual(asOf(pts([[3, 30], [1, 10]]), grid), [null, 10, 10, 30, null, null]);
  assert.deepEqual(asOf([], grid), [null, null, null, null, null, null]);
});

test("std band is the sample standard deviation around the mean", () => {
  const { mean, lo, hi } = aggregate([pts([[0, 1], [1, 2]]), pts([[0, 3], [1, 4]])], [0, 1], "std");
  assert.deepEqual(mean, pts([[0, 2], [1, 3]]));
  close(hi[0]!.y - mean[0]!.y, Math.SQRT2);
  close(mean[0]!.y - lo[0]!.y, Math.SQRT2);
});

test("sem divides the std by sqrt(n); minmax spans the members", () => {
  const members = [pts([[0, 1]]), pts([[0, 3]])];
  const sem = aggregate(members, [0], "sem");
  close(sem.hi[0]!.y - 2, Math.SQRT2 / Math.SQRT2);
  const mm = aggregate(members, [0], "minmax");
  assert.deepEqual([mm.lo[0]!.y, mm.mean[0]!.y, mm.hi[0]!.y], [1, 2, 3]);
});

test("a single member has zero spread; columns with no member are dropped", () => {
  const { mean, lo, hi } = aggregate([pts([[1, 5]])], [0, 1, 2], "std");
  assert.deepEqual(mean, pts([[1, 5]]));
  assert.deepEqual(lo, mean);
  assert.deepEqual(hi, mean);
});

test("aggregateGroups puts every group on the global union grid", () => {
  const out = aggregateGroups(
    [
      { key: "a", members: [pts([[0, 0], [10, 10]])] },
      { key: "b", members: [pts([[0, 1], [5, 2], [10, 3]])] },
    ],
    (m) => m,
    "std",
  );
  // Group "a" never logged x=5 but is sampled there (as of x=0).
  assert.deepEqual(out[0]!.mean.map((p) => p.x), [0, 5, 10]);
  assert.deepEqual(out[0]!.mean.map((p) => p.y), [0, 0, 10]);
  assert.deepEqual(out[1]!.mean.map((p) => p.x), [0, 5, 10]);
});

test("groupSeries draws members, band and mean per (metric, group)", () => {
  const s = (key: string, ys: number[]) => ({ key, label: key, color: "#000000", points: pts(ys.map((y, i) => [i, y])) });
  const item = (key: string, ys: number[], group: string | null, metric = "loss") =>
    ({ series: s(key, ys), metricKey: metric, metricName: metric, group });
  const { series, groups } = groupSeries(
    [item("r1", [1, 1], "A"), item("r2", [3, 3], "A"), item("r3", [5], "B"), item("r4", [0], null)],
    { band: "std", hideMembers: false, labelMetric: false },
  );
  assert.equal(groups, 2);
  assert.deepEqual(series.map((x) => [x.key, x.role ?? "line"]), [
    ["r1", "member"], ["r2", "member"],
    ["loss\u0000A", "bandHi"], ["loss\u0000A", "bandLo"], ["loss\u0000A", "line"],
    ["loss\u0000B", "line"],
    ["r4", "line"],
  ]);
  const mean = series[4]!;
  assert.equal(mean.label, "A (n=2)");
  assert.deepEqual(mean.points.map((p) => p.y), [2, 2]);
  // Everything in group A shares one colour; B gets the next; the ungrouped run keeps its own.
  assert.equal(new Set(series.slice(0, 5).map((x) => x.color)).size, 1);
  assert.notEqual(series[5]!.color, series[0]!.color);
  assert.notEqual(series[6]!.color, series[5]!.color);
  assert.equal(series[6]!.color, "#000000");

  const hidden = groupSeries([item("r1", [1], "A"), item("r2", [3], "A")], { band: "minmax", hideMembers: true, labelMetric: true });
  assert.deepEqual(hidden.series.map((x) => x.role), ["bandHi", "bandLo", "line"]);
  assert.equal(hidden.series[2]!.label, "loss · A (n=2)");
});

test("centre: mean, median (odd and even), min, max", () => {
  assert.equal(centre([3, 1, 2], "mean"), 2);
  assert.equal(centre([3, 1, 2], "median"), 2);
  assert.equal(centre([4, 1, 3, 2], "median"), 2.5);
  assert.equal(centre([3, 1, 2], "min"), 1);
  assert.equal(centre([3, 1, 2], "max"), 3);
});

test("aggregate draws the median / min / max as the centre line", () => {
  const members = [pts([[0, 1]]), pts([[0, 2]]), pts([[0, 9]])];
  assert.equal(aggregate(members, [0], "minmax", "median").mean[0]!.y, 2);
  assert.equal(aggregate(members, [0], "minmax", "min").mean[0]!.y, 1);
  assert.equal(aggregate(members, [0], "minmax", "max").mean[0]!.y, 9);
  // minmax band is the members' range whatever the centre.
  const med = aggregate(members, [0], "minmax", "median");
  assert.deepEqual([med.lo[0]!.y, med.hi[0]!.y], [1, 9]);
  // The std band spreads around the centre, not the mean.
  const sd = aggregate(members, [0], "std", "median");
  close(sd.hi[0]!.y - 2, 2 - sd.lo[0]!.y);
});

test("groupSeries: agg and groupColor options", () => {
  const s = (key: string, ys: number[]) => ({ key, label: key, color: "#000000", points: pts(ys.map((y, i) => [i, y])) });
  const item = (key: string, ys: number[], group: string) => ({ series: s(key, ys), metricKey: "m", metricName: "m", group });
  const { series } = groupSeries([item("a", [1], "G"), item("b", [2], "G"), item("c", [10], "G")], {
    band: "minmax", hideMembers: true, labelMetric: false, agg: "median", groupColor: () => "#123456",
  });
  const line = series.find((x) => x.role === "line")!;
  assert.equal(line.points[0]!.y, 2);
  assert.ok(series.every((x) => x.color === "#123456"));
});
