import { test } from "node:test";
import assert from "node:assert/strict";
import {
  correlationTone,
  encodeParams,
  featureImportances,
  fitForest,
  MIN_RUNS,
  mulberry32,
  parameterImportance,
  pearson,
  predictForest,
  sortImportance,
  type ImportanceRow,
  type ParamImportance,
} from "./importance.ts";

const close = (a: number | null, b: number, eps = 1e-9) => {
  assert.ok(a != null && Math.abs(a - b) < eps, `${a} != ${b}`);
};

test("pearson: perfect, inverse, constant, short", () => {
  close(pearson([1, 2, 3], [2, 4, 6]), 1);
  close(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1], [1]), null);
});

test("correlation colour follows the goal: lower wants a negative r, higher a positive one", () => {
  assert.equal(correlationTone(-0.7, "lower"), "good");
  assert.equal(correlationTone(0.7, "lower"), "bad");
  assert.equal(correlationTone(0.7, "higher"), "good");
  assert.equal(correlationTone(-0.7, "higher"), "bad");
  assert.equal(correlationTone(0.7, "none"), "neutral");
  assert.equal(correlationTone(null, "lower"), "neutral");
  assert.equal(correlationTone(0, "lower"), "neutral");
});

test("mulberry32 is deterministic per seed", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const x = mulberry32(1)();
  assert.ok(x >= 0 && x < 1);
});

test("encodeParams: numeric, bool, one-hot, missing, constant dropped", () => {
  const rows: ImportanceRow[] = [
    { params: { lr: 0.1, opt: "adam", flag: true, same: 1 }, target: 0 },
    { params: { lr: 0.2, opt: "sgd", flag: false, same: 1 }, target: 0 },
    { params: { opt: "adam", same: 1 }, target: 0 },
  ];
  const enc = encodeParams(rows);
  assert.deepEqual(
    enc.params.map((p) => [p.key, p.kind, p.columns.length]),
    [["flag", "numeric", 1], ["lr", "numeric", 1], ["opt", "categorical", 2]],
  );
  const lrCol = enc.params.find((p) => p.key === "lr")!.columns[0]!;
  close(enc.X[2]![lrCol]!, 0.15); // mean-imputed
  const [adam, sgd] = enc.params.find((p) => p.key === "opt")!.columns;
  assert.deepEqual(enc.X.map((r) => [r[adam!], r[sgd!]]), [[1, 0], [0, 1], [1, 0]]);
});

test("forest fits a step function", () => {
  const X = Array.from({ length: 40 }, (_, i) => [i]);
  const y = X.map(([x]) => (x! < 20 ? 0 : 10));
  const f = fitForest(X, y, { trees: 20, seed: 3 });
  assert.ok(predictForest(f, [2]) < 3);
  assert.ok(predictForest(f, [37]) > 7);
});

test("parameterImportance ranks the driving param first", () => {
  const rand = mulberry32(7);
  const rows: ImportanceRow[] = [];
  for (let i = 0; i < 60; i++) {
    const lr = rand();
    const noise = rand();
    const opt = rand() < 0.5 ? "adam" : "sgd";
    rows.push({ params: { lr, noise, opt }, target: -8 * lr + (opt === "adam" ? 3 : 0) });
  }
  const out = parameterImportance(rows);
  assert.equal(out[0]!.key, "lr");
  const byKey = Object.fromEntries(out.map((p) => [p.key, p]));
  assert.ok(byKey.lr!.importance > byKey.noise!.importance);
  assert.ok(byKey.opt!.importance > byKey.noise!.importance);
  assert.ok(byKey.lr!.correlation! < -0.7);
  assert.equal(byKey.opt!.correlation, null);
  assert.equal(byKey.opt!.kind, "categorical");
  close(out.reduce((a, p) => a + p.importance, 0), 1, 1e-9);
});

test("a sweep where lr drives the metric: lr gets the top importance, noise the least", () => {
  const rand = mulberry32(11);
  const rows: ImportanceRow[] = [];
  for (let i = 0; i < 12; i++) {
    const lr = [1e-5, 1e-4, 1e-3][i % 3]!;
    const batch = [32, 64, 128][Math.floor(rand() * 3)]!;
    const noise = rand() * 0.5;
    rows.push({ params: { lr, batch_size: batch, noise }, target: 0.5 + 0.1 * Math.log10(lr) + 0.01 * rand() });
  }
  const out = parameterImportance(rows);
  assert.equal(out[0]!.key, "lr");
  assert.ok(out[0]!.importance > 0.5);
  close(out.reduce((a, p) => a + p.importance, 0), 1, 1e-9);
});

test("impurity importances: per tree normalised, then over the forest; no split scores 0", () => {
  const X = Array.from({ length: 20 }, (_, i) => [i, i % 2]);
  const y = X.map(([a]) => a!);
  const imp = featureImportances(fitForest(X, y, { trees: 10, seed: 1 }));
  close(imp[0]! + imp[1]!, 1);
  assert.ok(imp[0]! > imp[1]!);
  const flat = featureImportances(fitForest(X, X.map(() => 3), { trees: 5 }));
  assert.deepEqual(flat, [0, 0]);
});

test("sorting by correlation: strongest |r| first, none last", () => {
  const rows: ParamImportance[] = [
    { key: "a", kind: "numeric", importance: 0.5, correlation: 0.1 },
    { key: "b", kind: "categorical", importance: 0.3, correlation: null },
    { key: "c", kind: "numeric", importance: 0.2, correlation: -0.8 },
  ];
  assert.deepEqual(sortImportance(rows, "importance").map((r) => r.key), ["a", "b", "c"]);
  assert.deepEqual(sortImportance(rows, "correlation").map((r) => r.key), ["c", "a", "b"]);
});

test("parameterImportance is deterministic (seeded forest)", () => {
  const rows: ImportanceRow[] = Array.from({ length: 12 }, (_, i) => ({
    params: { a: i, b: i % 3, c: (i * 7) % 5 },
    target: i * 2 + (i % 3),
  }));
  assert.deepEqual(parameterImportance(rows), parameterImportance(rows));
  assert.deepEqual(parameterImportance(rows, { seed: 4 }), parameterImportance(rows, { seed: 4 }));
});

test("parameterImportance: needs MIN_RUNS (5) runs with a finite target", () => {
  assert.equal(MIN_RUNS, 5);
  const four = Array.from({ length: 4 }, (_, i) => ({ params: { a: i }, target: i }));
  assert.deepEqual(parameterImportance(four), []);
  assert.deepEqual(parameterImportance([...four, { params: { a: 9 }, target: NaN }]), []);
  assert.equal(parameterImportance([...four, { params: { a: 9 }, target: 9 }]).length, 1);
});
