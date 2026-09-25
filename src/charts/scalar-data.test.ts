import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignSeries,
  compileSeriesExpr,
  compileTemplate,
  derivedLine,
  exprMetrics,
  limitRuns,
  makeRunContext,
  metricRef,
  metricLine,
  renderLabel,
  sequenceData,
  xAxisKind,
} from "./scalar-data.ts";
import type { Series } from "../lib/plot-utils/types.ts";

const T0 = Date.parse("2024-01-01T00:00:00Z");
const pt = (step: number, y: number | null, sec = step) => ({
  step,
  scalar_value: y,
  wall_time: new Date(T0 + sec * 1000).toISOString(),
});

function ctxOf(series: Record<string, ReturnType<typeof pt>[]>, extra: Parameters<typeof makeRunContext>[0] extends infer A ? Partial<A> : never = {}) {
  const m = new Map(Object.entries(series).map(([k, v]) => [k, sequenceData(v)]));
  return makeRunContext({ series: m, ...extra });
}

const node = (src: string) => {
  const c = compileSeriesExpr(src);
  assert.equal(c.error, null, c.error?.message);
  return c.value!;
};

test("x = step: each point at its own step", () => {
  const ctx = ctxOf({ loss: [pt(0, 5), pt(10, 4)] });
  const { points, warnings } = metricLine("loss", node("step"), ctx);
  assert.deepEqual(points.map((p) => [p.x, p.y]), [[0, 5], [10, 4]]);
  assert.deepEqual(warnings, []);
  assert.equal(points[0]!.wallTime, "2024-01-01T00:00:00.000Z");
});

test("x = step * 32 scales the steps", () => {
  const ctx = ctxOf({ loss: [pt(1, 5), pt(2, 4)] });
  assert.deepEqual(metricLine("loss", node("step * 32"), ctx).points.map((p) => p.x), [32, 64]);
});

test("x = a metric: joined as of each step; steps before it are dropped", () => {
  const ctx = ctxOf({ loss: [pt(0, 5), pt(5, 4), pt(10, 3), pt(12, 2)], epoch: [pt(3, 0), pt(10, 1)] });
  const { points } = metricLine("loss", node("epoch"), ctx);
  assert.deepEqual(points.map((p) => [p.x, p.y]), [[0, 4], [1, 3], [1, 2]]);
});

test("x = relative_time: seconds since the run started", () => {
  const ctx = ctxOf({ loss: [pt(0, 1, 10), pt(1, 2, 20)] }, { run: { id: "r", created_at: new Date(T0).toISOString() } });
  assert.deepEqual(metricLine("loss", node("relative_time"), ctx).points.map((p) => p.x), [10, 20]);
});

test("a derived series joins two metrics as of the first's steps, with a warning", () => {
  const ctx = ctxOf({ a: [pt(0, 10), pt(2, 20), pt(4, 30)], b: [pt(0, 2), pt(3, 5)] });
  const { points, warnings } = derivedLine(node("a / b"), node("step"), ctx);
  assert.deepEqual(points.map((p) => [p.x, p.y]), [[0, 5], [2, 10], [4, 6]]);
  assert.equal(warnings[0]?.kind, "asof-join");
  // Wall times follow the first metric's points.
  assert.equal(points[1]!.wallTime, new Date(T0 + 2000).toISOString());
});

test("a derived series on one metric has no warning", () => {
  const ctx = ctxOf({ a: [pt(0, 1), pt(1, 4)] });
  const { points, warnings } = derivedLine(node("a * 2 + 1"), node("step * 10"), ctx);
  assert.deepEqual(points.map((p) => [p.x, p.y]), [[0, 3], [10, 9]]);
  assert.deepEqual(warnings, []);
});

test("compileSeriesExpr: parse and type errors carry their span; scalars are rejected", () => {
  const bad = compileSeriesExpr("loss +");
  assert.ok(bad.error);
  assert.ok(bad.error.span.start >= 0);
  const scalar = compileSeriesExpr("max(loss)");
  assert.match(scalar.error!.message, /expected a series/);
  assert.deepEqual(scalar.error!.span, { start: 0, end: 9 });
  assert.deepEqual(exprMetrics(node("a / b + a")), ["a", "b"]);
});

test("templates render config, run fields and stats; failures fall back", () => {
  const ctx = ctxOf(
    { loss: [pt(0, 3), pt(1, 1)] },
    { config: { lr: 0.001 }, run: { id: "r1", display_name: "alpha", stats: { loss: { min: 0.5 } } } },
  );
  const tpl = compileTemplate("${run.name} lr=${config.lr} best=${min(loss)}");
  assert.equal(tpl.error, null);
  // The stat (0.5) wins over the fetched series' min (1).
  assert.equal(renderLabel(tpl.value, ctx, "x"), "alpha lr=0.001 best=0.5");
  assert.equal(compileTemplate("").value, null);
  assert.ok(compileTemplate("${loss}").error, "a series hole is an error");
  assert.equal(renderLabel(null, ctx, "fallback"), "fallback");
  assert.equal(renderLabel(compileTemplate("${config.missing}").value, ctx, "fb"), "fb");
});

test("xAxisKind", () => {
  assert.equal(xAxisKind(" wall_time "), "wall_time");
  assert.equal(xAxisKind("step"), "step");
  assert.equal(xAxisKind("step * 2"), "value");
});

test("limitRuns: newest per group, then the cap", () => {
  const group: Record<string, string | null> = { a: "g1", b: "g1", c: "g2", d: null, e: null };
  const created: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
  const opts = { groupOf: (id: string) => group[id]!, createdAt: (id: string) => created[id] };
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual(limitRuns(ids, { ...opts, latestPerGroup: true, maxRuns: null }), ["b", "c", "d", "e"]);
  assert.deepEqual(limitRuns(ids, { ...opts, latestPerGroup: true, maxRuns: 2 }), ["b", "c"]);
  assert.deepEqual(limitRuns(ids, { ...opts, latestPerGroup: false, maxRuns: 3 }), ["a", "b", "c"]);
});

const S = (key: string, pts: Array<[number, number]>, role?: Series["role"]): Series => ({
  key, label: key, color: "#000", points: pts.map(([x, y]) => ({ x, y })), role,
});
const base = { smoothing: 0, smoothingKind: "ema" as const, outlierPct: [0, 100] as [number, number], xScale: "linear" as const, yScale: "linear" as const };

test("alignSeries: shared x grid, nulls where a line did not log", () => {
  const { xs, ys } = alignSeries([S("a", [[0, 1], [2, 3]]), S("b", [[1, 5]])], base);
  assert.deepEqual(xs, [0, 1, 2]);
  assert.deepEqual(ys, [[1, null, 3], [null, 5, null]]);
});

test("alignSeries: showOriginal toggles the raw copy under a smoothed line", () => {
  const s = [S("a", [[0, 1], [1, 5], [2, 1]])];
  const on = alignSeries(s, { ...base, smoothing: 0.6 });
  assert.deepEqual(on.lines.map((l) => l.role), ["raw", "line"]);
  const off = alignSeries(s, { ...base, smoothing: 0.6, showOriginal: false });
  assert.deepEqual(off.lines.map((l) => l.role), ["line"]);
});

test("alignSeries: stacked draws cumulative tops of the lines only", () => {
  const s = [S("a", [[0, 1], [1, 2]]), S("m", [[0, 9]], "member"), S("b", [[0, 10], [1, 20]])];
  const { lines, ys } = alignSeries(s, { ...base, stack: "stacked" });
  assert.deepEqual(lines.map((l) => l.key), ["a", "b"]);
  assert.deepEqual(ys, [[1, 2], [11, 22]]);
  // Points keep each line's own value for the tooltip.
  assert.equal(lines[1]!.points[0]!.y, 10);
  const pct = alignSeries(s, { ...base, stack: "percent" });
  assert.deepEqual(pct.ys[1], [100, 100]);
});

test("alignSeries: bucketing adds a min/max envelope per line", () => {
  const dense = S("a", Array.from({ length: 100 }, (_, i) => [i, i % 2] as [number, number]));
  const { lines, xs } = alignSeries([dense], { ...base, bucket: { lo: null, hi: null, buckets: 10 } });
  assert.deepEqual(lines.map((l) => l.role), ["envHi", "envLo", "line"]);
  assert.equal(xs.length, 10);
});

test("metricRef quotes names that are not plain metric names", () => {
  assert.equal(metricRef("val.loss"), "val.loss");
  assert.equal(metricRef("train/loss"), "`train/loss`");
  assert.equal(metricRef("step"), "`step`");
  assert.equal(metricRef("a`b"), "`a``b`");
  for (const name of ["train/loss", "step", "a`b", "config.lr"]) {
    const c = compileSeriesExpr(metricRef(name));
    assert.deepEqual(exprMetrics(c.value), [name]);
  }
});
